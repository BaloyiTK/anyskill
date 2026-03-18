// src/routes/userRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { authorizeRoles } from "../middleware/roleMiddleware.js";
import { getUsers, getUserById, toggleUserRole } from "../controllers/userController.js";

const router = express.Router();

// Only admin can view all users
router.get("/", protect, authorizeRoles("admin"), getUsers);

// Any logged-in user can get their own user info
router.get("/:id", protect, getUserById);


router.put("/toggle-role", protect, toggleUserRole);

export default router;