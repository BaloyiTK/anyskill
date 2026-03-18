// src/routes/authRoutes.js
import express from "express";
import { registerUser, loginUser, changePassword } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";


const router = express.Router();

// Self-registration allowed for workers/employers, no token needed
// Admin creation will still be validated in the controller
router.post("/register", registerUser);

router.post("/login", loginUser);
router.put("/change-password", protect, changePassword);

export default router;