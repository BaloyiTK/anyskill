// src/routes/jobRoutes.js
import express from "express";
import { createJob, getJobs } from "../controllers/jobController.js";
import { authorizeRoles, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", protect, authorizeRoles("employer"), createJob);
router.get("/", protect, authorizeRoles("worker"), getJobs);

export default router;