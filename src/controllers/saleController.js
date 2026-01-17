// Sale Controller
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';

// Helper to get userId from request
const getUserId = async (req) => {
  // First try to get userId from header
  const userIdFromHeader = req.headers['x-user-id'];
  if (userIdFromHeader) {
    return userIdFromHeader;
  }
  
  // Fallback: if no header, try to find user by email from localStorage (for backward compatibility)
  // This should not happen in normal flow, but kept for safety
  const User = (await import('../models/User.js')).default;
  const user = await User.findOne();
  return user?._id;
};

export const getSales = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const { startDate, endDate, product } = req.query;
    const query = { userId };

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

    const sales = await Sale.find(query).sort({ date: -1 });
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
    if (saleData.date) saleData.date = new Date(saleData.date);

    // If productId is provided, try to find and update product stock
    if (saleData.productId) {
      const product = await Product.findOne({ _id: saleData.productId, userId });
      if (product) {
        product.stock = Math.max(0, product.stock - saleData.quantity);
        await product.save();
      }
    }

    const sale = new Sale(saleData);
    await sale.save();

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

    const updateData = { ...req.body };
    
    // Convert string numbers to numbers
    if (updateData.quantity) updateData.quantity = parseInt(updateData.quantity);
    if (updateData.revenue) updateData.revenue = parseFloat(updateData.revenue);
    if (updateData.cost) updateData.cost = parseFloat(updateData.cost);
    if (updateData.profit) updateData.profit = parseFloat(updateData.profit);
    if (updateData.date) updateData.date = new Date(updateData.date);

    const sale = await Sale.findOneAndUpdate(
      { _id: req.params.id, userId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

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

    const sale = await Sale.findOneAndDelete({ _id: req.params.id, userId });
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

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
