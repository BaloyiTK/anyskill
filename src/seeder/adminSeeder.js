// src/seeder/adminSeeder.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import connectDB from "../config/db.js";

dotenv.config();
connectDB();

const seedAdmin = async () => {
  try {
    // Read email and password from .env
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.error("Please set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
      process.exit(1);
    }

    const adminExists = await User.findOne({ email: adminEmail });
    if (adminExists) {
      console.log("Admin user already exists");
      process.exit();
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const admin = await User.create({
      name: "Admin User",
      email: adminEmail,
      phone: "0800000001",       // default phone
      password: hashedPassword,
      role: "admin",
      emailVerified: true,
      phoneVerified: true
    });

    console.log("Admin seeded:", admin);
    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedAdmin();