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
    .custom((value) => {
      // Allow "admin" as a special case for admin login (skip email validation)
      if (value && value.toLowerCase().trim() === 'admin') {
        return true;
      }
      // For other values, validate as email if provided
      if (value && value.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          throw new Error('Please provide a valid email address');
        }
      }
      return true;
    })
    .customSanitizer((value) => {
      // Don't normalize "admin", but normalize other emails
      if (value && value.toLowerCase().trim() === 'admin') {
        return value.trim().toLowerCase();
      }
      // For valid emails, normalize them
      if (value && value.includes('@')) {
        return value.trim().toLowerCase();
      }
      return value ? value.trim() : value;
    }),
  
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
    .notEmpty().withMessage('Product name is required')
    .isLength({ min: 1, max: 200 }).withMessage('Product name must be between 1 and 200 characters'),
  
  body('productId')
    .optional()
    .isMongoId().withMessage('Invalid product ID format'),
  
  body('quantity')
    .notEmpty().withMessage('Quantity is required')
    .isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  
  body('revenue')
    .notEmpty().withMessage('Revenue is required')
    .isFloat({ min: 0 }).withMessage('Revenue must be a non-negative number'),
  
  body('cost')
    .notEmpty().withMessage('Cost is required')
    .isFloat({ min: 0 }).withMessage('Cost must be a non-negative number'),
  
  body('profit')
    .notEmpty().withMessage('Profit is required')
    .isFloat().withMessage('Profit must be a number'),
  
  body('date')
    .optional()
    .isISO8601().withMessage('Sale date must be a valid ISO 8601 date'),
  
  body('paymentMethod')
    .optional()
    .trim()
    .isIn(['cash', 'card', 'momo', 'airtel', 'transfer']).withMessage('Invalid payment method'),
  
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
    .notEmpty().withMessage('Product name is required for all sales')
    .isLength({ min: 1, max: 200 }).withMessage('Product name must be between 1 and 200 characters'),
  
  body('sales.*.productId')
    .optional()
    .isMongoId().withMessage('Invalid product ID format'),
  
  body('sales.*.quantity')
    .notEmpty().withMessage('Quantity is required for all sales')
    .isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  
  body('sales.*.revenue')
    .notEmpty().withMessage('Revenue is required for all sales')
    .isFloat({ min: 0 }).withMessage('Revenue must be a non-negative number'),
  
  body('sales.*.cost')
    .notEmpty().withMessage('Cost is required for all sales')
    .isFloat({ min: 0 }).withMessage('Cost must be a non-negative number'),
  
  body('sales.*.profit')
    .notEmpty().withMessage('Profit is required for all sales')
    .isFloat().withMessage('Profit must be a number'),
  
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
