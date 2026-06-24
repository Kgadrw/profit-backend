// Product Controller
import Product from '../models/Product.js';
import Inventory from '../models/Inventory.js';
import { broadcastScopeChange } from '../utils/workspaceRealtime.js';
import { buildListQuery, buildCreateScope, buildActorFields, assertPageAccess } from '../utils/dataScope.js';

function handleScopeError(res, error) {
  const status = error.statusCode || 500;
  return res.status(status).json({ error: error.message || 'Request failed' });
}

export const getProducts = async (req, res) => {
  try {
    assertPageAccess(req, 'products');
    const { inventoryId } = req.query;
    const query = buildListQuery(req);
    if (inventoryId) {
      query.inventoryId = inventoryId === 'null' ? null : inventoryId;
    }

    const products = await Product.find(query).sort({ createdAt: -1 });
    res.json({ data: products });
  } catch (error) {
    console.error('Get products error:', error);
    handleScopeError(res, error);
  }
};

export const getProduct = async (req, res) => {
  try {
    assertPageAccess(req, 'products');
    const query = buildListQuery(req, { _id: req.params.id });
    const product = await Product.findOne(query);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ data: product });
  } catch (error) {
    console.error('Get product error:', error);
    handleScopeError(res, error);
  }
};

export const createProduct = async (req, res) => {
  try {
    assertPageAccess(req, 'products');
    const productData = {
      ...req.body,
      ...buildCreateScope(req),
      ...buildActorFields(req),
    };

    if (productData.inventoryId) {
      const invQuery = buildListQuery(req, { _id: productData.inventoryId });
      const inv = await Inventory.findOne(invQuery);
      if (!inv) {
        return res.status(404).json({ error: 'Inventory not found' });
      }
    } else if (productData.inventoryId === null || productData.inventoryId === '') {
      productData.inventoryId = null;
    }

    if (productData.costPrice) productData.costPrice = parseFloat(productData.costPrice);
    if (productData.sellingPrice) productData.sellingPrice = parseFloat(productData.sellingPrice);
    if (productData.stock) productData.stock = parseInt(productData.stock, 10);
    if (productData.minStock) productData.minStock = parseInt(productData.minStock, 10);
    if (productData.packageQuantity) productData.packageQuantity = parseInt(productData.packageQuantity, 10);

    if (!productData.category || !String(productData.category).trim()) {
      productData.category = 'General';
    }

    const normalizedName = productData.name.trim().toLowerCase();
    const normalizedCategory = productData.category.trim().toLowerCase();
    const productType = productData.productType?.trim() || null;

    const duplicateQuery = buildListQuery(req, {
      name: { $regex: new RegExp(`^${normalizedName}$`, 'i') },
      category: { $regex: new RegExp(`^${normalizedCategory}$`, 'i') },
    });

    if (productType) {
      duplicateQuery.productType = productType;
    } else {
      duplicateQuery.$or = [
        { productType: { $exists: false } },
        { productType: null },
        { productType: '' },
      ];
    }

    const existingProduct = await Product.findOne(duplicateQuery);
    if (existingProduct) {
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
          },
        });
      }
      return res.status(409).json({
        error: 'A product with the same name, category, and type already exists.',
        duplicate: true,
        outOfStock: false,
      });
    }

    const product = new Product(productData);
    await product.save();

    await broadcastScopeChange(req, 'product:created', product);

    res.status(201).json({
      message: 'Product created successfully',
      data: product,
    });
  } catch (error) {
    console.error('Create product error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const updateProduct = async (req, res) => {
  try {
    assertPageAccess(req, 'products');
    const updateData = {
      ...req.body,
      ...buildActorFields(req, { isUpdate: true }),
    };
    delete updateData.__v;
    delete updateData.userId;
    delete updateData.workspaceId;
    delete updateData.createdByUserId;
    delete updateData.createdByName;

    if (updateData.costPrice) updateData.costPrice = parseFloat(updateData.costPrice);
    if (updateData.sellingPrice) updateData.sellingPrice = parseFloat(updateData.sellingPrice);
    if (updateData.stock) updateData.stock = parseInt(updateData.stock, 10);
    if (updateData.minStock) updateData.minStock = parseInt(updateData.minStock, 10);
    if (updateData.packageQuantity) updateData.packageQuantity = parseInt(updateData.packageQuantity, 10);

    const query = buildListQuery(req, { _id: req.params.id });
    const product = await Product.findOneAndUpdate(
      query,
      { $set: updateData },
      { new: true, runValidators: true },
    );

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await broadcastScopeChange(req, 'product:updated', product);

    res.json({
      message: 'Product updated successfully',
      data: product,
    });
  } catch (error) {
    console.error('Update product error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const deleteProduct = async (req, res) => {
  try {
    assertPageAccess(req, 'products');
    const query = buildListQuery(req, { _id: req.params.id });
    const product = await Product.findOneAndDelete(query);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await broadcastScopeChange(req, 'product:deleted', { _id: product._id, workspaceId: product.workspaceId });

    res.json({
      message: 'Product deleted successfully',
      data: product,
    });
  } catch (error) {
    console.error('Delete product error:', error);
    handleScopeError(res, error);
  }
};
