// src/controllers/adminController.js
import User from "../models/User.js";
import bcrypt from "bcryptjs";

// Create admin (by superadmin)
export const createAdmin = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    const existing = await User.findOne({ $or: [{ email }, { phone }] });
    if (existing) return res.status(400).json({ success: false, message: "User already exists" });

    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

    const admin = await User.create({
      name,
      email,
      phone,
      role: "admin",
      password: hashedPassword,
      emailVerified: true,
      phoneVerified: true,
      onboardingStage: "complete",
      mustChangePassword: password ? true : false
    });

    res.status(201).json({ success: true, message: "Admin created successfully", admin });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Reset admin password (by superadmin)
export const resetPassword = async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.mustChangePassword = true;
    await user.save();

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};