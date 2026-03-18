// src/models/User.js
import mongoose from "mongoose";

const addressSchema = new mongoose.Schema({
  fullAddress: String,       // Human readable (e.g. "Sandton, Johannesburg")
  street: String,
  city: String,
  province: String,
  country: { type: String, default: "South Africa" },
  postalCode: String,

  location: {
    lat: Number,
    lng: Number
  }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  role: { type: String, enum: ["worker", "employer", "admin", "_admin"], default: "worker" },

  // 🔥 ADDRESS SECTION
  homeAddress: addressSchema,        // stable (set once during onboarding)
  currentAddress: addressSchema,     // dynamic (updates when user moves)
  lastLocationUpdate: Date,          // track when current location changed

  // Verification flags
  selfie: String,
  selfieVerified: { type: Boolean, default: false },
  lastSelfieCheck: Date,

  idDocument: String,
  idVerified: { type: Boolean, default: false },

  emailVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },

  // OTPs for three channels
  otpWhatsApp: {
    code: String,
    expiresAt: Date,
    verified: { type: Boolean, default: false }
  },
  otpSMS: {
    code: String,
    expiresAt: Date,
    verified: { type: Boolean, default: false }
  },
  otpEmail: {
    code: String,
    expiresAt: Date,
    verified: { type: Boolean, default: false }
  },

  onboardingStage: { type: String, default: "otp" }, // stages: otp -> personal -> selfie -> id -> complete
  mustChangePassword: { type: Boolean, default: false }

}, { timestamps: true });

export default mongoose.model("User", userSchema);