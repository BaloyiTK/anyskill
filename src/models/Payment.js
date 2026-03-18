// src/models/Payment.js
import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true
    },

    payer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    payee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    amount: {
      type: Number,
      required: true
    },

    commission: {
      type: Number,
      default: 0
    },

    status: {
      type: String,
      enum: ["pending", "held", "completed", "cancelled"],
      default: "pending"
    },

    paymentMethod: {
      type: String,
      enum: ["card", "bank", "wallet"],
      default: "card"
    }
  },
  { timestamps: true }
);

export default mongoose.model("Payment", paymentSchema);