// Input Validation Middleware
import { body, param, query, validationResult } from 'express-validator';

// Validation error handler
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.param,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

// User registration validation
export const validateRegister = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('Name can only contain letters, spaces, hyphens, and apostrophes'),
  
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  
  body('pin')
    .trim()
    .notEmpty().withMessage('PIN is required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .matches(/^\d{4}$/).withMessage('PIN must contain only digits'),
  
  body('businessName')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Business name must not exceed 200 characters'),
  
  handleValidationErrors
];

// User login validation
export const validateLogin = [
  body('pin')
    .trim()
    .notEmpty().withMessage('PIN is required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .matches(/^\d{4}$/).withMessage('PIN must contain only digits'),
  
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  
  handleValidationErrors
];

// Product validation
export const validateProduct = [
  body('name')
    .trim()
    .notEmpty().withMessage('Product name is required')
    .isLength({ min: 1, max: 200 }).withMessage('Product name must be between 1 and 200 characters'),
  
  body('category')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Category must not exceed 100 characters'),
  
  body('type')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Type must not exceed 100 characters'),
  
  body('stock')
    .notEmpty().withMessage('Stock is required')
    .isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
  
  body('buyingPrice')
    .optional()
    .isFloat({ min: 0 }).withMessage('Buying price must be a non-negative number'),
  
  body('sellingPrice')
    .notEmpty().withMessage('Selling price is required')
    .isFloat({ min: 0 }).withMessage('Selling price must be a non-negative number'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Description must not exceed 1000 characters'),
  
  handleValidationErrors
];

// Sale validation
export const validateSale = [
  body('product')
    .trim()
    .notEmpty().withMessage('Product ID is required')
    .isMongoId().withMessage('Invalid product ID format'),
  
  body('quantity')
    .notEmpty().withMessage('Quantity is required')
    .isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  
  body('sellingPrice')
    .notEmpty().withMessage('Selling price is required')
    .isFloat({ min: 0 }).withMessage('Selling price must be a non-negative number'),
  
  body('paymentMethod')
    .optional()
    .trim()
    .isIn(['cash', 'momo', 'card', 'airtel', 'transfer']).withMessage('Invalid payment method'),
  
  body('saleDate')
    .optional()
    .isISO8601().withMessage('Sale date must be a valid ISO 8601 date'),
  
  handleValidationErrors
];

// Bulk sale validation
export const validateBulkSales = [
  body('sales')
    .isArray().withMessage('Sales must be an array')
    .notEmpty().withMessage('Sales array cannot be empty')
    .isLength({ max: 100 }).withMessage('Cannot process more than 100 sales at once'),
  
  body('sales.*.product')
    .trim()
    .notEmpty().withMessage('Product ID is required for all sales')
    .isMongoId().withMessage('Invalid product ID format'),
  
  body('sales.*.quantity')
    .notEmpty().withMessage('Quantity is required for all sales')
    .isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  
  body('sales.*.sellingPrice')
    .notEmpty().withMessage('Selling price is required for all sales')
    .isFloat({ min: 0 }).withMessage('Selling price must be a non-negative number'),
  
  handleValidationErrors
];

// MongoDB ObjectId validation
export const validateObjectId = [
  param('id')
    .isMongoId().withMessage('Invalid ID format'),
  
  handleValidationErrors
];

// Query parameter validation
export const validateDateRange = [
  query('startDate')
    .optional()
    .isISO8601().withMessage('Start date must be a valid ISO 8601 date'),
  
  query('endDate')
    .optional()
    .isISO8601().withMessage('End date must be a valid ISO 8601 date'),
  
  handleValidationErrors
];
