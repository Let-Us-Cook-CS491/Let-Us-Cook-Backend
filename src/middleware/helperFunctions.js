
function isValidTimeZone(tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch (err) {
      return false;
    }
}

function isValidWeightUnit(unit) {
    if (unit !== "g" && unit !== "ml" && unit !== "pcs" && unit !== "kg" && unit !== "L" && unit !== "pack" && unit !== "oz" && unit !== "lb") {
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

function isValidGoal(goal) {
    if (goal !== "Lose Weight" && goal !== "Maintain Weight" && goal !== "Gain Weight") {
        return false;
    }
    return true;
}

function isValidActivityLevel(activity) {
    if (activity !== "Sedentary" && activity !== "Light" && activity !== "Moderate" && activity !== "Active" && activity !== "Very Active") {
        return false;
    }
    return true;
}

module.exports = { isValidTimeZone, isValidWeightUnit, isValidCategory, isValidGoal, isValidActivityLevel };