// Health Check
exports.healthCheck = async (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "Let Us Cook Server: Online",
        timestamp: new Date().toLocaleString(),
    });
};


