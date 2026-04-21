/**
 * Values stored in notifications_inbox.page (varchar(32)).
 * Use these from producers so the SPA route keys stay consistent.
 */
const NOTIFICATION_PAGES = Object.freeze({
  FRIDGE: '/fridge',
  RECIPES: '/recipes',
  PROFILE: '/profile',
});

const ALLOWED_PAGE_VALUES = new Set(Object.values(NOTIFICATION_PAGES));

function isAllowedNotificationPage(page) {
  return typeof page === 'string' && ALLOWED_PAGE_VALUES.has(page);
}

module.exports = {
  NOTIFICATION_PAGES,
  ALLOWED_PAGE_VALUES,
  isAllowedNotificationPage,
};
