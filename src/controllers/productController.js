// Product Controller
import Product from '../models/Product.js';
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

export const getProducts = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const products = await Product.find({ userId }).sort({ createdAt: -1 });
    res.json({ data: products });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch products' });
  }
};

export const getProduct = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const product = await Product.findOne({ _id: req.params.id, userId });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ data: product });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch product' });
  }
};

export const createProduct = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const productData = {
      ...req.body,
      userId,
    };

    // Convert string numbers to numbers
    if (productData.costPrice) productData.costPrice = parseFloat(productData.costPrice);
    if (productData.sellingPrice) productData.sellingPrice = parseFloat(productData.sellingPrice);
    if (productData.stock) productData.stock = parseInt(productData.stock);
    if (productData.minStock) productData.minStock = parseInt(productData.minStock);
    if (productData.packageQuantity) productData.packageQuantity = parseInt(productData.packageQuantity);

    // Check for duplicate product (same name, category, and productType)
    const normalizedName = productData.name.trim().toLowerCase();
    const normalizedCategory = productData.category.trim().toLowerCase();
    const productType = productData.productType?.trim() || null;

    const duplicateQuery = {
      userId,
      name: { $regex: new RegExp(`^${normalizedName}$`, 'i') }, // Case-insensitive match
      category: { $regex: new RegExp(`^${normalizedCategory}$`, 'i') }, // Case-insensitive match
    };

    // Include productType in the query if it exists, otherwise check for null/undefined
    if (productType) {
      duplicateQuery.productType = productType;
    } else {
      duplicateQuery.$or = [
        { productType: { $exists: false } },
        { productType: null },
        { productType: '' }
      ];
    }

    const existingProduct = await Product.findOne(duplicateQuery);
    if (existingProduct) {
      // If product is out of stock, return it so frontend can offer to update/restock
      if (existingProduct.stock === 0) {
        return res.status(409).json({ 
          error: 'A product with the same name, category, and type already exists and is out of stock.',
          duplicate: true,
          outOfStock: true,
          existingProduct: {
            _id: existingProduct._id,
            name: existingProduct.name,
            category: existingProduct.category,
            stock: existingProduct.stock,
            costPrice: existingProduct.costPrice,
            sellingPrice: existingProduct.sellingPrice,
            productType: existingProduct.productType,
          }
        });
      }
      return res.status(409).json({ 
        error: 'A product with the same name, category, and type already exists.',
        duplicate: true,
        outOfStock: false
      });
    }

    const product = new Product(productData);
    await product.save();

    // Emit WebSocket event for real-time update
    emitToUser(userId, 'product:created', product.toObject());

    res.status(201).json({ 
      message: 'Product created successfully',
      data: product 
    });
  } catch (error) {
    console.error('Create product error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to create product' });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const updateData = { ...req.body };
    
    // Remove MongoDB version field to avoid version conflicts
    delete updateData.__v;
    
    // Convert string numbers to numbers
    if (updateData.costPrice) updateData.costPrice = parseFloat(updateData.costPrice);
    if (updateData.sellingPrice) updateData.sellingPrice = parseFloat(updateData.sellingPrice);
    if (updateData.stock) updateData.stock = parseInt(updateData.stock);
    if (updateData.minStock) updateData.minStock = parseInt(updateData.minStock);
    if (updateData.packageQuantity) updateData.packageQuantity = parseInt(updateData.packageQuantity);

    // Use $set operator to avoid version conflicts
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Emit WebSocket event for real-time update
    emitToUser(userId, 'product:updated', product.toObject());

    // Keep product even when stock reaches 0 so it can be shown in Low Stock Alert
    res.json({ 
      message: 'Product updated successfully',
      data: product 
    });
  } catch (error) {
    console.error('Update product error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    // Handle VersionError specifically
    if (error.name === 'VersionError') {
      // Retry with fresh data from database
      try {
        const freshProduct = await Product.findOne({ _id: req.params.id, userId });
        if (!freshProduct) {
          return res.status(404).json({ error: 'Product not found' });
        }
        
        const updateData = { ...req.body };
        delete updateData.__v;
        delete updateData._id;
        
        // Convert string numbers to numbers
        if (updateData.costPrice) updateData.costPrice = parseFloat(updateData.costPrice);
        if (updateData.sellingPrice) updateData.sellingPrice = parseFloat(updateData.sellingPrice);
        if (updateData.stock) updateData.stock = parseInt(updateData.stock);
        if (updateData.minStock) updateData.minStock = parseInt(updateData.minStock);
        if (updateData.packageQuantity) updateData.packageQuantity = parseInt(updateData.packageQuantity);
        
        // Update with fresh version
        Object.assign(freshProduct, updateData);
        const updatedProduct = await freshProduct.save();
        
        emitToUser(userId, 'product:updated', updatedProduct.toObject());
        
        return res.json({ 
          message: 'Product updated successfully',
          data: updatedProduct 
        });
      } catch (retryError) {
        console.error('Retry update product error:', retryError);
        return res.status(500).json({ error: 'Failed to update product due to version conflict. Please refresh and try again.' });
      }
    }
    res.status(500).json({ error: error.message || 'Failed to update product' });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(404).json({ error: 'User not found. Please login first.' });
    }

    const product = await Product.findOneAndDelete({ _id: req.params.id, userId });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Emit WebSocket event for real-time update
    emitToUser(userId, 'product:deleted', { _id: product._id });

    res.json({ 
      message: 'Product deleted successfully',
      data: product 
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete product' });
  }
};
