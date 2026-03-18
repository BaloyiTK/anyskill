// src/routes/otpRoutes.js
import express from "express";
import { sendOTP, verifyOTP } from "../controllers/otpController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Protected routes: user must be logged in (JWT)
router.post("/send", protect, sendOTP);
router.post("/verify", protect, verifyOTP);

export default router;