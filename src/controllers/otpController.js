// src/controllers/otpController.js
import User from "../models/User.js";
import { generateOTP } from "../utils/otp.js";
import { sendEmail } from "../utils/sendEmail.js";
import bcrypt from "bcryptjs";

export const sendOTP = async (req, res) => {
  try {
    const user = req.user; // user must be logged in (protected route)
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const otpEmail = generateOTP();

    // Save hashed OTP to user
    user.otpEmail = {
      code: await bcrypt.hash(otpEmail, 10),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min expiry
      verified: false
    };

    await user.save();

    // Send OTP via email
    await sendEmail(user.email, "Your OTP Code", `Your email OTP is: ${otpEmail}`);

    res.json({ success: true, message: "Email OTP sent successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyOTP = async (req, res) => {
  try {
    const { code } = req.body;

    const user = req.user; // from protect middleware

    if (!user || !user.otpEmail) {
      return res.status(400).json({
        success: false,
        message: "No OTP found"
      });
    }

    // Check expiry
    if (new Date() > user.otpEmail.expiresAt) {
      return res.status(400).json({
        success: false,
        message: "OTP expired"
      });
    }

    // Compare OTP
    const isMatch = await bcrypt.compare(code, user.otpEmail.code);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    // Mark verified
    user.otpEmail.verified = true;
    user.emailVerified = true;

    user.onboardingStage = "selfie";
 
    await user.save();

    res.json({
      success: true,
      message: "Email verified successfully",
      emailVerified: true
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};