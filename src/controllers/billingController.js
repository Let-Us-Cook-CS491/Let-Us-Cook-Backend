const db = require('../config/databaseConnection');
const { getStripeClient } = require('../services/stripeService');

const ALLOWED_PAID_PLAN_CODES = new Set(['premium_monthly', 'ultra_monthly']);

function fromUnixTimestamp(unixSeconds) {
    if (!unixSeconds) return null;
    return new Date(unixSeconds * 1000);
}

async function findPlanByCode(connection, planCode) {
    const [rows] = await connection.execute(
        `SELECT plan_id, code, display_name, stripe_price_id, billing_interval, amount_cents, currency, is_active
         FROM subscription_plans
         WHERE code = ?
         LIMIT 1`,
        [planCode]
    );

    return rows[0] || null;
}

function resolvePriceIdForPlan(plan) {
    if (plan?.stripe_price_id) {
        return plan.stripe_price_id;
    }

    if (plan?.code === 'premium_monthly') {
        return process.env.STRIPE_PRICE_PREMIUM_MONTHLY || null;
    }

    if (plan?.code === 'ultra_monthly') {
        return process.env.STRIPE_PRICE_ULTRA_MONTHLY || null;
    }

    return null;
}

async function getOrCreateStripeCustomer(connection, userId) {
    const [existingMapping] = await connection.execute(
        `SELECT stripe_customer_id
         FROM user_billing_customers
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (existingMapping.length > 0) {
        return existingMapping[0].stripe_customer_id;
    }

    const [users] = await connection.execute(
        `SELECT email, full_name
         FROM users
         WHERE user_id = ?
         LIMIT 1`,
        [userId]
    );

    if (users.length === 0) {
        throw new Error('User not found');
    }

    const stripe = getStripeClient();
    const stripeCustomer = await stripe.customers.create({
        email: users[0].email || undefined,
        name: users[0].full_name || undefined,
        metadata: {
            user_id: String(userId),
        },
    });

    await connection.execute(
        `INSERT INTO user_billing_customers (user_id, stripe_customer_id)
         VALUES (?, ?)`,
        [userId, stripeCustomer.id]
    );

    return stripeCustomer.id;
}

async function findUserIdByStripeCustomer(connection, stripeCustomerId) {
    const [rows] = await connection.execute(
        `SELECT user_id
         FROM user_billing_customers
         WHERE stripe_customer_id = ?
         LIMIT 1`,
        [stripeCustomerId]
    );

    if (rows.length === 0) return null;
    return rows[0].user_id;
}

async function findPlanIdByPriceId(connection, stripePriceId) {
    if (!stripePriceId) return null;

    const [rows] = await connection.execute(
        `SELECT plan_id
         FROM subscription_plans
         WHERE stripe_price_id = ?
         LIMIT 1`,
        [stripePriceId]
    );

    if (rows.length === 0) return null;
    return rows[0].plan_id;
}

async function upsertSubscriptionFromStripeObject(connection, userId, subscription) {
    const firstItem = subscription?.items?.data?.[0];
    const stripePriceId = firstItem?.price?.id || null;
    const planId = await findPlanIdByPriceId(connection, stripePriceId);

    if (!planId) {
        throw new Error(`No subscription plan mapped for Stripe price ${stripePriceId || 'unknown'}`);
    }

    await connection.execute(
        `INSERT INTO user_subscriptions (
            user_id,
            plan_id,
            provider,
            provider_subscription_id,
            status,
            cancel_at_period_end,
            current_period_start,
            current_period_end,
            canceled_at,
            ended_at
        ) VALUES (?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            plan_id = VALUES(plan_id),
            status = VALUES(status),
            cancel_at_period_end = VALUES(cancel_at_period_end),
            current_period_start = VALUES(current_period_start),
            current_period_end = VALUES(current_period_end),
            canceled_at = VALUES(canceled_at),
            ended_at = VALUES(ended_at)`,
        [
            userId,
            planId,
            subscription.id,
            subscription.status,
            subscription.cancel_at_period_end ? 1 : 0,
            fromUnixTimestamp(subscription.current_period_start),
            fromUnixTimestamp(subscription.current_period_end),
            fromUnixTimestamp(subscription.canceled_at),
            fromUnixTimestamp(subscription.ended_at),
        ]
    );
}

async function recordBillingEvent(connection, event, userId = null, processed = false) {
    await connection.execute(
        `INSERT INTO billing_events (user_id, stripe_event_id, event_type, payload_json, processed_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            user_id = COALESCE(VALUES(user_id), user_id),
            processed_at = COALESCE(VALUES(processed_at), processed_at)`,
        [
            userId,
            event.id,
            event.type,
            JSON.stringify(event),
            processed ? new Date() : null,
        ]
    );
}

exports.createCheckoutSession = async (req, res) => {
    const rawUserId = req.user?.user_id;
    const userId = Number(rawUserId);
    const { plan_code } = req.body || {};

    if (!Number.isInteger(userId)) {
        return res.status(401).json({
            status: 'ERROR',
            message: 'Unauthorized user',
        });
    }

    if (!plan_code || !ALLOWED_PAID_PLAN_CODES.has(plan_code)) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Invalid plan code. Use premium_monthly or ultra_monthly.',
        });
    }

    if (!process.env.STRIPE_SUCCESS_URL || !process.env.STRIPE_CANCEL_URL) {
        return res.status(500).json({
            status: 'ERROR',
            message: 'Missing Stripe success/cancel URL configuration',
        });
    }

    let connection;

    try {
        connection = await db.getConnection();

        const plan = await findPlanByCode(connection, plan_code);
        if (!plan || Number(plan.is_active) !== 1) {
            return res.status(404).json({
                status: 'ERROR',
                message: 'Plan not found or inactive',
            });
        }

        const stripePriceId = resolvePriceIdForPlan(plan);
        if (!stripePriceId) {
            return res.status(500).json({
                status: 'ERROR',
                message: 'No Stripe price configured for this plan',
            });
        }

        const stripeCustomerId = await getOrCreateStripeCustomer(connection, userId);
        const stripe = getStripeClient();

        const checkoutSession = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: stripeCustomerId,
            line_items: [
                {
                    price: stripePriceId,
                    quantity: 1,
                },
            ],
            success_url: process.env.STRIPE_SUCCESS_URL,
            cancel_url: process.env.STRIPE_CANCEL_URL,
            client_reference_id: String(userId),
            metadata: {
                user_id: String(userId),
                plan_code,
            },
        });

        return res.status(200).json({
            status: 'OK',
            message: 'Checkout session created',
            data: {
                session_id: checkoutSession.id,
                checkout_url: checkoutSession.url,
            },
        });
    } catch (error) {
        return res.status(500).json({
            status: 'ERROR',
            message: 'Failed to create checkout session',
            error: error.message,
        });
    } finally {
        if (connection) await connection.release();
    }
};

exports.getCurrentSubscription = async (req, res) => {
    const rawUserId = req.user?.user_id;
    const userId = Number(rawUserId);

    if (!Number.isInteger(userId)) {
        return res.status(401).json({
            status: 'ERROR',
            message: 'Unauthorized user',
        });
    }

    let connection;

    try {
        connection = await db.getConnection();

        const [rows] = await connection.execute(
            `SELECT us.status,
                    us.cancel_at_period_end,
                    us.current_period_start,
                    us.current_period_end,
                    sp.code AS plan_code,
                    sp.display_name,
                    sp.tier_rank
             FROM user_subscriptions us
             INNER JOIN subscription_plans sp ON sp.plan_id = us.plan_id
             WHERE us.user_id = ?
             ORDER BY us.updated_at DESC
             LIMIT 1`,
            [userId]
        );

        if (rows.length === 0) {
            return res.status(200).json({
                status: 'OK',
                data: {
                    plan_code: 'free',
                    status: 'active',
                    tier_rank: 0,
                    cancel_at_period_end: 0,
                    current_period_start: null,
                    current_period_end: null,
                },
            });
        }

        return res.status(200).json({
            status: 'OK',
            data: rows[0],
        });
    } catch (error) {
        return res.status(500).json({
            status: 'ERROR',
            message: 'Failed to fetch current subscription',
            error: error.message,
        });
    } finally {
        if (connection) await connection.release();
    }
};

exports.handleStripeWebhook = async (req, res) => {
    const stripe = getStripeClient();
    const signature = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
        return res.status(400).json({
            status: 'ERROR',
            message: 'Missing Stripe webhook signature or secret',
        });
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (error) {
        return res.status(400).json({
            status: 'ERROR',
            message: `Webhook signature verification failed: ${error.message}`,
        });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        await recordBillingEvent(connection, event, null, false);

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const sessionUserId = Number(session?.metadata?.user_id || session?.client_reference_id);
            const customerId = session?.customer;

            if (Number.isInteger(sessionUserId) && customerId) {
                await connection.execute(
                    `INSERT INTO user_billing_customers (user_id, stripe_customer_id)
                     VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE stripe_customer_id = VALUES(stripe_customer_id)`,
                    [sessionUserId, customerId]
                );

                if (session.subscription) {
                    const subscription = await stripe.subscriptions.retrieve(session.subscription);
                    await upsertSubscriptionFromStripeObject(connection, sessionUserId, subscription);
                }

                await recordBillingEvent(connection, event, sessionUserId, true);
            }
        } else if (
            event.type === 'customer.subscription.updated' ||
            event.type === 'customer.subscription.deleted'
        ) {
            const subscription = event.data.object;
            const customerId = subscription?.customer;
            const mappedUserId = await findUserIdByStripeCustomer(connection, customerId);

            if (mappedUserId) {
                await upsertSubscriptionFromStripeObject(connection, mappedUserId, subscription);
                await recordBillingEvent(connection, event, mappedUserId, true);
            }
        } else {
            await recordBillingEvent(connection, event, null, true);
        }

        await connection.commit();
        return res.status(200).json({ received: true });
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') {
            if (connection) await connection.rollback();
            return res.status(200).json({ received: true, duplicate: true });
        }

        if (connection) await connection.rollback();
        return res.status(500).json({
            status: 'ERROR',
            message: 'Failed to process Stripe webhook',
            error: error.message,
        });
    } finally {
        if (connection) await connection.release();
    }
};
