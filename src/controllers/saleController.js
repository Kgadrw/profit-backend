// Sale Controller
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import Service from '../models/Service.js';
import Barber from '../models/Barber.js';
import { emitToUser } from '../utils/websocket.js';

// Helper to get userId from request
const getUserId = async (req) => {
  // First try to get userId from header
  const userIdFromHeader = req.headers['x-user-id'];
  if (userIdFromHeader) {
    // Validate it's a valid MongoDB ObjectId
    const mongoose = (await import('mongoose')).default;
    if (mongoose.Types.ObjectId.isValid(userIdFromHeader)) {
    return userIdFromHeader;
  }
  }
  
  // If no valid userId in header, return null (user must login)
  return null;
};

export const getSales = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Get user to check role
    const User = (await import('../models/User.js')).default;
    const user = await User.findById(userId);
    
    const { startDate, endDate, product, isService, barberId } = req.query;
    const query = {};

    // If user is a barber, only show their sales
    if (user && user.role === 'barber' && user.barberId) {
      query.barberId = user.barberId;
      // Use salon owner's userId for the query
      query.userId = user.salonOwnerId;
    } else {
      // Salon owner sees all sales for their business
      query.userId = userId;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    if (product) {
      query.product = { $regex: product, $options: 'i' };
    }

    if (isService !== undefined) {
      query.isService = isService === 'true';
    }

    // Additional barberId filter (for salon owners filtering by barber)
    if (barberId && (!user || user.role !== 'barber')) {
      query.barberId = barberId;
    }

    const sales = await Sale.find(query)
      .populate('serviceId', 'name category')
      .populate('barberId', 'name')
      .sort({ date: -1 });
    res.json({ data: sales });
  } catch (error) {
    console.error('Get sales error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch sales' });
  }
};

export const getSale = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const sale = await Sale.findOne({ _id: req.params.id, userId });
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    res.json({ data: sale });
  } catch (error) {
    console.error('Get sale error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch sale' });
  }
};

export const createSale = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const saleData = {
      ...req.body,
      userId,
    };

    // Convert string numbers to numbers
    if (saleData.quantity) saleData.quantity = parseInt(saleData.quantity);
    if (saleData.revenue) saleData.revenue = parseFloat(saleData.revenue);
    if (saleData.cost) saleData.cost = parseFloat(saleData.cost);
    if (saleData.profit) saleData.profit = parseFloat(saleData.profit);
    if (saleData.customAmount) saleData.customAmount = parseFloat(saleData.customAmount);
    if (saleData.date) saleData.date = new Date(saleData.date);

    // Handle service sales
    if (saleData.isService) {
      // Validate service and barber exist and belong to user
      if (saleData.serviceId) {
        const service = await Service.findOne({ _id: saleData.serviceId, userId });
        if (!service) {
          return res.status(404).json({ error: 'Service not found' });
        }
      }

      if (saleData.barberId) {
        const barber = await Barber.findOne({ _id: saleData.barberId, userId });
        if (!barber) {
          return res.status(404).json({ error: 'Barber not found' });
        }
      }

      // Calculate revenue based on pricing priority:
      // 1. Custom amount (if provided)
      // 2. Service default price
      if (!saleData.revenue) {
        let calculatedRevenue = 0;

        if (saleData.customAmount) {
          // Priority 1: Custom amount
          calculatedRevenue = saleData.customAmount;
        } else if (saleData.serviceId) {
          // Priority 2: Service default price
          const service = await Service.findOne({ _id: saleData.serviceId, userId });
          if (service && service.defaultPrice) {
            calculatedRevenue = service.defaultPrice;
          }
        }

        // If still no revenue calculated, require it to be provided
        if (calculatedRevenue === 0 && !saleData.revenue) {
          return res.status(400).json({ 
            error: 'Revenue is required. Please provide customAmount or service default price.' 
          });
        }

        saleData.revenue = calculatedRevenue;
      }

      // For services, cost is typically 0 unless specified
      if (!saleData.cost) {
        saleData.cost = 0;
      }

      // Calculate profit
      saleData.profit = saleData.revenue - saleData.cost;

      // Set product name from service name for display
      if (saleData.serviceId && !saleData.product) {
        const service = await Service.findOne({ _id: saleData.serviceId, userId });
        if (service) {
          saleData.product = service.name;
        }
      }
    } else {
      // Handle product sales (existing logic)
    // If productId is provided, try to find and update product stock
    if (saleData.productId) {
      const product = await Product.findOne({ _id: saleData.productId, userId });
      if (product) {
        product.stock = Math.max(0, product.stock - saleData.quantity);
        await product.save();
        // Keep product even when stock reaches 0 so it can be shown in Low Stock Alert
        }
      }
    }

    const sale = new Sale(saleData);
    await sale.save();

    // Emit WebSocket event for real-time update
    emitToUser(userId, 'sale:created', sale.toObject());

    res.status(201).json({ 
      message: 'Sale recorded successfully',
      data: sale 
    });
  } catch (error) {
    console.error('Create sale error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to create sale' });
  }
};

export const createBulkSales = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const { sales } = req.body;
    if (!Array.isArray(sales) || sales.length === 0) {
      return res.status(400).json({ error: 'Sales array is required' });
    }

    const createdSales = [];
    for (const saleData of sales) {
      const processedSale = {
        ...saleData,
        userId,
      };

      // Convert string numbers to numbers
      if (processedSale.quantity) processedSale.quantity = parseInt(processedSale.quantity);
      if (processedSale.revenue) processedSale.revenue = parseFloat(processedSale.revenue);
      if (processedSale.cost) processedSale.cost = parseFloat(processedSale.cost);
      if (processedSale.profit) processedSale.profit = parseFloat(processedSale.profit);
      if (processedSale.date) processedSale.date = new Date(processedSale.date);

      // Update product stock if productId is provided
      if (processedSale.productId) {
        const product = await Product.findOne({ _id: processedSale.productId, userId });
        if (product) {
          product.stock = Math.max(0, product.stock - processedSale.quantity);
          await product.save();
          // Keep product even when stock reaches 0 so it can be shown in Low Stock Alert
        }
      }

      const sale = new Sale(processedSale);
      await sale.save();
      createdSales.push(sale);
    }

    res.status(201).json({ 
      message: `${createdSales.length} sales recorded successfully`,
      data: createdSales 
    });
  } catch (error) {
    console.error('Create bulk sales error:', error);
    res.status(500).json({ error: error.message || 'Failed to create sales' });
  }
};

export const updateSale = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Find the existing sale first to get old values
    const oldSale = await Sale.findOne({ _id: req.params.id, userId });
    if (!oldSale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const updateData = { ...req.body };
    
    // Convert string numbers to numbers
    if (updateData.quantity) updateData.quantity = parseInt(updateData.quantity);
    if (updateData.revenue) updateData.revenue = parseFloat(updateData.revenue);
    if (updateData.cost) updateData.cost = parseFloat(updateData.cost);
    if (updateData.profit) updateData.profit = parseFloat(updateData.profit);
    if (updateData.date) updateData.date = new Date(updateData.date);

    // Handle stock updates if quantity or productId changed
    const quantityChanged = updateData.quantity !== undefined && updateData.quantity !== oldSale.quantity;
    const productIdChanged = updateData.productId !== undefined && 
                             updateData.productId.toString() !== oldSale.productId?.toString();

    if (quantityChanged || productIdChanged) {
      // Restore stock from old sale
      if (oldSale.productId) {
        const oldProduct = await Product.findOne({ _id: oldSale.productId, userId });
        if (oldProduct) {
          oldProduct.stock = oldProduct.stock + oldSale.quantity;
          await oldProduct.save();
        }
      }

      // Reduce stock for new/updated sale
      const newProductId = updateData.productId || oldSale.productId;
      if (newProductId) {
        const newProduct = await Product.findOne({ _id: newProductId, userId });
        if (newProduct) {
          const newQuantity = updateData.quantity !== undefined ? updateData.quantity : oldSale.quantity;
          newProduct.stock = Math.max(0, newProduct.stock - newQuantity);
          await newProduct.save();
        }
      }
    }

    const sale = await Sale.findOneAndUpdate(
      { _id: req.params.id, userId },
      updateData,
      { new: true, runValidators: true }
    )
      .populate('serviceId', 'name category')
      .populate('barberId', 'name');

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Emit WebSocket event for real-time update
    emitToUser(userId, 'sale:updated', sale.toObject());

    res.json({ 
      message: 'Sale updated successfully',
      data: sale 
    });
  } catch (error) {
    console.error('Update sale error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to update sale' });
  }
};

export const deleteSale = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Find the sale first to get productId and quantity before deleting
    const sale = await Sale.findOne({ _id: req.params.id, userId });
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Restore product stock if productId is provided
    if (sale.productId) {
      const product = await Product.findOne({ _id: sale.productId, userId });
      if (product) {
        product.stock = product.stock + sale.quantity;
        await product.save();
      }
    }

    // Now delete the sale
    await Sale.findByIdAndDelete(req.params.id);

    // Emit WebSocket event for real-time update
    emitToUser(userId, 'sale:deleted', { _id: sale._id });

    res.json({ 
      message: 'Sale deleted successfully',
      data: sale 
    });
  } catch (error) {
    console.error('Delete sale error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete sale' });
  }
};

export const deleteAllSales = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    // Find all sales first to restore stock
    const allSales = await Sale.find({ userId });
    
    // Group sales by productId and sum quantities to restore stock efficiently
    const stockRestorations = new Map();
    for (const sale of allSales) {
      if (sale.productId) {
        const productId = sale.productId.toString();
        const currentQuantity = stockRestorations.get(productId) || 0;
        stockRestorations.set(productId, currentQuantity + sale.quantity);
      }
    }

    // Restore stock for each product
    for (const [productId, totalQuantity] of stockRestorations.entries()) {
      try {
        const product = await Product.findOne({ _id: productId, userId });
        if (product) {
          product.stock = product.stock + totalQuantity;
          await product.save();
        }
      } catch (error) {
        console.error(`Error restoring stock for product ${productId}:`, error);
        // Continue with other products even if one fails
      }
    }

    // Now delete all sales
    const result = await Sale.deleteMany({ userId });
    
    res.json({ 
      message: `Successfully deleted ${result.deletedCount} sale(s)`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Delete all sales error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete all sales' });
  }
};
