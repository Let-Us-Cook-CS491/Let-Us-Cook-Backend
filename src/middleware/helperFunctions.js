
function isValidTimeZone(tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch (err) {
      return false;
    }
}

function isValidWeightUnit(unit) {
    if (unit !== "g" && unit !== "ml" && unit !== "pcs" && unit !== "kg" && unit !== "L" && unit !== "pack") {
        return false;
    }
    return true;
}

function isValidCategory(category) {
    if (category !== "Produce" && category !== "Protein" && category !== "Dairy" && category !== "Pantry" && category !== "Bakery") {
        return false;
    }
    return true;
}

module.exports = { isValidTimeZone, isValidWeightUnit, isValidCategory };