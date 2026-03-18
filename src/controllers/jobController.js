// src/controllers/jobController.js
import Job from "../models/Job.js";

// Create a job
export const createJob = async (req, res) => {
  try {
    const { title, description, location } = req.body;

    const job = await Job.create({
      title,
      description,
      location,
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      message: "Job created successfully",
      job
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get all jobs
export const getJobs = async (req, res) => {
  try {
    const jobs = await Job.find();
    res.status(200).json({
      success: true,
      jobs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};