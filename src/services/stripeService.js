const Stripe = require('stripe');

let stripeClient = null;

function getStripeClient() {
    if (!stripeClient) {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        if (!secretKey) {
            throw new Error('STRIPE_SECRET_KEY is not set');
        }

        stripeClient = new Stripe(secretKey);
    }

    return stripeClient;
}

module.exports = {
    getStripeClient,
};
