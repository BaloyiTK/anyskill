// src/controllers/userController.js
import User from "../models/User.js";

// Get all users
export const getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get single user by ID
export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Toggle role between worker <-> employer (self)
export const toggleUserRole = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Only worker ↔ employer allowed
    if (user.role === "worker") user.role = "employer";
    else if (user.role === "employer") user.role = "worker";
    else return res.status(403).json({ success: false, message: "Cannot toggle this role" });

    await user.save();

    res.json({
      success: true,
      message: `Role switched to ${user.role}`,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};