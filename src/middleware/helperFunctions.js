
function isValidTimeZone(tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch (err) {
      return false;
    }
}

module.exports = { isValidTimeZone };