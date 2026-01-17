// Product Controller
import Product from '../models/Product.js';

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
      return res.status(409).json({ 
        error: 'A product with the same name, category, and type already exists.',
        duplicate: true
      });
    }

    const product = new Product(productData);
    await product.save();

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
    
    // Convert string numbers to numbers
    if (updateData.costPrice) updateData.costPrice = parseFloat(updateData.costPrice);
    if (updateData.sellingPrice) updateData.sellingPrice = parseFloat(updateData.sellingPrice);
    if (updateData.stock) updateData.stock = parseInt(updateData.stock);
    if (updateData.minStock) updateData.minStock = parseInt(updateData.minStock);
    if (updateData.packageQuantity) updateData.packageQuantity = parseInt(updateData.packageQuantity);

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, userId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ 
      message: 'Product updated successfully',
      data: product 
    });
  } catch (error) {
    console.error('Update product error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
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

    res.json({ 
      message: 'Product deleted successfully',
      data: product 
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete product' });
  }
};
