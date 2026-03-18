// src/routes/paymentRoutes.js
import express from "express";

import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { createPayment, getPayments } from "../controllers/paymentController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Only employers can create a payment
router.post("/", protect, authorizeRoles("employer"), createPayment);

// Both roles can view payments
router.get("/", protect, authorizeRoles("worker", "employer"), getPayments);

export default router;