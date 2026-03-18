// src/controllers/paymentController.js
import Payment from "../models/Payment.js";

// Create a payment


export const createPayment = async (req, res) => {
    console.log("HEADERS:", req.headers);
console.log("BODY:", req.body);
    
  try {
    const { job, payer, payee, amount } = req.body;

    console.log("job")

    const payment = await Payment.create({
      job,
      payer,
      payee,
      amount
    });

    res.status(201).json({
      success: true,
      message: "Payment created successfully",
      payment
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// Get all payments
export const getPayments = async (req, res) => {
  try {

    const payments = await Payment.find()
      .populate("job")
      .populate("payer")
      .populate("payee");

    res.status(200).json({
      success: true,
      count: payments.length,
      payments
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// Get single payment
export const getPaymentById = async (req, res) => {
  try {

    const payment = await Payment.findById(req.params.id)
      .populate("job")
      .populate("payer")
      .populate("payee");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found"
      });
    }

    res.status(200).json({
      success: true,
      payment
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};