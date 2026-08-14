// Sale Controller
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import Service from '../models/Service.js';
import Client from '../models/Client.js';
import { broadcastScopeChange } from '../utils/workspaceRealtime.js';
import { buildListQuery, buildCreateScope, buildActorFields, assertPageAccess } from '../utils/dataScope.js';

function handleScopeError(res, error) {
  const status = error.statusCode || 500;
  return res.status(status).json({ error: error.message || 'Request failed' });
}

const getUserId = (req) => req.user?._id;

// Helper to deduct stock for inventory products (skip services)
const deductProductStock = async (product, quantity) => {
  if (!product || product.category === 'service') return product;
  product.stock = Math.max(0, (product.stock ?? 0) - quantity);
  await product.save();
  return product;
};

// Helper to restore stock for inventory products
const restoreProductStock = async (product, quantity) => {
  if (!product || product.category === 'service') return product;
  product.stock = (product.stock ?? 0) + quantity;
  await product.save();
  return product;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Attach optional customer / free-text buyer to sale payload. */
async function resolveBuyerFields(req, saleData) {
  const rawBuyer =
    saleData.buyerName != null && saleData.buyerName !== undefined
      ? String(saleData.buyerName).trim()
      : '';
  let clientId = saleData.clientId;
  if (clientId === '' || clientId === undefined || clientId === null) {
    clientId = null;
  }

  if (clientId) {
    const client = await Client.findOne(buildListQuery(req, { _id: clientId }));
    if (!client) {
      const error = new Error('Customer not found');
      error.statusCode = 400;
      throw error;
    }
    saleData.clientId = client._id;
    saleData.buyerName = rawBuyer || client.name || '';
  } else {
    saleData.clientId = null;
    saleData.buyerName = rawBuyer;
  }
}

/** Resolve inventory product by Mongo id or exact name (case-insensitive). */
const resolveInventoryProduct = async (req, productId, productName) => {
  const mongoose = (await import('mongoose')).default;

  if (productId && mongoose.Types.ObjectId.isValid(String(productId))) {
    const byId = await Product.findOne(buildListQuery(req, { _id: productId }));
    if (byId && byId.category !== 'service') return byId;
  }

  const name = String(productName || '').trim();
  if (name) {
    const byName = await Product.findOne(
      buildListQuery(req, {
        name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') },
        category: { $ne: 'service' },
      }),
    );
    if (byName) return byName;
  }

  return null;
};

const applySaleStockDeduction = async (req, saleData) => {
  const product = await resolveInventoryProduct(req, saleData.productId, saleData.product);
  if (!product) return null;

  saleData.productId = product._id;
  if (saleData.inventoryId === undefined) {
    saleData.inventoryId = product.inventoryId ?? null;
  }

  const qty = Number(saleData.quantity) || 0;
  if (qty > 0 && qty > (product.stock ?? 0)) {
    const err = new Error(`Insufficient stock for ${product.name}. Only ${product.stock ?? 0} available.`);
    err.statusCode = 400;
    throw err;
  }

  const updated = await deductProductStock(product, qty);
  if (updated) {
    await broadcastScopeChange(req, 'product:updated', updated);
  }
  return updated;
};

export const getSales = async (req, res) => {
  try {
    assertPageAccess(req, 'sales');
    const { startDate, endDate, product, isService, saleType, workerId, inventoryId } = req.query;
    const query = buildListQuery(req);

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

    if (saleType) {
      query.saleType = saleType;
    }

    if (workerId) {
      query.workerId = workerId;
    }

    if (inventoryId) {
      query.inventoryId = inventoryId === 'null' ? null : inventoryId;
    }

    const sales = await Sale.find(query)
      .populate('serviceId', 'name category')
      .populate('workerId', 'name clientType')
      .sort({ date: -1 });
    res.json({ data: sales });
  } catch (error) {
    console.error('Get sales error:', error);
    handleScopeError(res, error);
  }
};

export const getSale = async (req, res) => {
  try {
    assertPageAccess(req, 'sales');
    const query = buildListQuery(req, { _id: req.params.id });
    const sale = await Sale.findOne(query);
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    res.json({ data: sale });
  } catch (error) {
    console.error('Get sale error:', error);
    handleScopeError(res, error);
  }
};

export const createSale = async (req, res) => {
  try {
    assertPageAccess(req, 'sales');
    const userId = getUserId(req);
    const saleData = {
      ...req.body,
      ...buildCreateScope(req),
      ...buildActorFields(req),
    };

    // Idempotency: offline sync / mobile retries can repeat the same POST.
    // Return the already-created sale before touching stock or balances.
    if (saleData.clientRequestId) {
      const existingSale = await Sale.findOne(
        buildListQuery(req, { clientRequestId: saleData.clientRequestId }),
      );
      if (existingSale) {
        return res.status(200).json({
          message: 'Sale already recorded',
          data: existingSale,
        });
      }
    }

    // Convert string numbers to numbers (allow 0 — do not use truthy checks)
    if (saleData.quantity != null && saleData.quantity !== '') saleData.quantity = parseInt(saleData.quantity);
    if (saleData.revenue != null && saleData.revenue !== '') saleData.revenue = parseFloat(saleData.revenue);
    if (saleData.cost != null && saleData.cost !== '') saleData.cost = parseFloat(saleData.cost);
    if (saleData.profit != null && saleData.profit !== '') saleData.profit = parseFloat(saleData.profit);
    if (saleData.customAmount != null && saleData.customAmount !== '') saleData.customAmount = parseFloat(saleData.customAmount);
    if (saleData.date) saleData.date = new Date(saleData.date);

    try {
      await resolveBuyerFields(req, saleData);
    } catch (buyerErr) {
      if (buyerErr.statusCode === 400) {
        return res.status(400).json({ error: buyerErr.message });
      }
      throw buyerErr;
    }

    const isServiceSale = saleData.saleType === 'service' || saleData.isService === true;
    saleData.saleType = isServiceSale ? 'service' : 'product';
    saleData.isService = isServiceSale;

    // Handle service sales
    if (isServiceSale) {
      // Validate service and barber exist and belong to user
      if (saleData.serviceId) {
        const service = await Service.findOne({ _id: saleData.serviceId, userId });
        if (!service) {
          return res.status(404).json({ error: 'Service not found' });
        }
      }

      if (saleData.workerId) {
        const worker = await Client.findOne({ _id: saleData.workerId, userId, clientType: 'worker' });
        if (!worker) {
          return res.status(404).json({ error: 'Worker not found' });
        }
        saleData.workerName = saleData.workerName || worker.name;
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
      if (saleData.cost == null || !Number.isFinite(Number(saleData.cost))) {
        saleData.cost = 0;
      }

      // Calculate profit (0 when cost equals revenue/selling total)
      const serviceRevenue = Number(saleData.revenue) || 0;
      const serviceCost = Number(saleData.cost) || 0;
      const serviceProfit = serviceRevenue - serviceCost;
      saleData.profit = Math.abs(serviceProfit) < 0.005 ? 0 : Math.round(serviceProfit * 100) / 100;

      // Set product-like display name from service details for compatibility
      if (!saleData.serviceName && saleData.serviceId) {
        const service = await Service.findOne({ _id: saleData.serviceId, userId });
        if (service) {
          saleData.serviceName = service.name;
        }
      }
      saleData.product = saleData.product || saleData.serviceName || 'Service';
      saleData.productId = undefined;
      saleData.inventoryId = null;
    } else {
      // Handle product sales — deduct stock by productId or product name
      try {
        await applySaleStockDeduction(req, saleData);
      } catch (stockErr) {
        if (stockErr.statusCode === 400) {
          return res.status(400).json({ error: stockErr.message });
        }
        throw stockErr;
      }
    }

    {
      const revenue = Number(saleData.revenue) || 0;
      const cost = Number(saleData.cost) || 0;
      const profit = revenue - cost;
      saleData.profit = Math.abs(profit) < 0.005 ? 0 : Math.round(profit * 100) / 100;
    }

    const sale = new Sale(saleData);
    await sale.save();

    await broadcastScopeChange(req, 'sale:created', sale);

    res.status(201).json({ 
      message: 'Sale recorded successfully',
      data: sale 
    });
  } catch (error) {
    console.error('Create sale error:', error);
    // A simultaneous duplicate request can race the lookup above. The unique
    // index is the final guard; undo this request's stock deduction, then
    // return the original instead of failing/retrying.
    if (error?.code === 11000 && req.body?.clientRequestId) {
      const isProductSale =
        req.body?.saleType !== 'service' && req.body?.isService !== true;
      if (isProductSale) {
        try {
          const product = await resolveInventoryProduct(req, req.body.productId, req.body.product);
          const restored = await restoreProductStock(product, Number(req.body.quantity) || 0);
          if (restored) await broadcastScopeChange(req, 'product:updated', restored);
        } catch (restoreError) {
          console.error('Failed to restore duplicate sale stock:', restoreError);
        }
      }
      const existingSale = await Sale.findOne(
        buildListQuery(req, { clientRequestId: req.body.clientRequestId }),
      );
      if (existingSale) {
        return res.status(200).json({
          message: 'Sale already recorded',
          data: existingSale,
        });
      }
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const createBulkSales = async (req, res) => {
  try {
    assertPageAccess(req, 'sales');
    const { sales } = req.body;
    if (!Array.isArray(sales) || sales.length === 0) {
      return res.status(400).json({ error: 'Sales array is required' });
    }

    const createdSales = [];
    for (const saleData of sales) {
      const processedSale = {
        ...saleData,
        ...buildCreateScope(req),
        ...buildActorFields(req),
      };

      // Convert string numbers to numbers (allow 0)
      if (processedSale.quantity != null && processedSale.quantity !== '') processedSale.quantity = parseInt(processedSale.quantity);
      if (processedSale.revenue != null && processedSale.revenue !== '') processedSale.revenue = parseFloat(processedSale.revenue);
      if (processedSale.cost != null && processedSale.cost !== '') processedSale.cost = parseFloat(processedSale.cost);
      if (processedSale.profit != null && processedSale.profit !== '') processedSale.profit = parseFloat(processedSale.profit);
      if (processedSale.date) processedSale.date = new Date(processedSale.date);

      {
        const revenue = Number(processedSale.revenue) || 0;
        const cost = Number(processedSale.cost) || 0;
        const profit = revenue - cost;
        processedSale.profit = Math.abs(profit) < 0.005 ? 0 : Math.round(profit * 100) / 100;
      }

      // Update product stock for inventory products
      try {
        await applySaleStockDeduction(req, processedSale);
      } catch (stockErr) {
        if (stockErr.statusCode === 400) {
          return res.status(400).json({ error: stockErr.message });
        }
        throw stockErr;
      }

      const sale = new Sale(processedSale);
      await sale.save();
      await broadcastScopeChange(req, 'sale:created', sale);
      createdSales.push(sale);
    }

    res.status(201).json({ 
      message: `${createdSales.length} sales recorded successfully`,
      data: createdSales 
    });
  } catch (error) {
    console.error('Create bulk sales error:', error);
    handleScopeError(res, error);
  }
};

export const updateSale = async (req, res) => {
  try {
    assertPageAccess(req, 'sales');
    const userId = getUserId(req);

    const oldSale = await Sale.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!oldSale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const updateData = {
      ...req.body,
      ...buildActorFields(req, { isUpdate: true }),
    };
    delete updateData.userId;
    delete updateData.workspaceId;
    delete updateData.createdByUserId;
    delete updateData.createdByName;
    
    // Convert string numbers to numbers (allow 0)
    if (updateData.quantity != null && updateData.quantity !== '') updateData.quantity = parseInt(updateData.quantity);
    if (updateData.revenue != null && updateData.revenue !== '') updateData.revenue = parseFloat(updateData.revenue);
    if (updateData.cost != null && updateData.cost !== '') updateData.cost = parseFloat(updateData.cost);
    if (updateData.profit != null && updateData.profit !== '') updateData.profit = parseFloat(updateData.profit);
    if (updateData.date) updateData.date = new Date(updateData.date);

    if (updateData.clientId !== undefined || updateData.buyerName !== undefined) {
      try {
        await resolveBuyerFields(req, updateData);
      } catch (buyerErr) {
        if (buyerErr.statusCode === 400) {
          return res.status(400).json({ error: buyerErr.message });
        }
        throw buyerErr;
      }
    }

    const quantityChanged = updateData.quantity !== undefined && updateData.quantity !== oldSale.quantity;
    const productIdChanged = updateData.productId !== undefined && 
                             updateData.productId.toString() !== oldSale.productId?.toString();

    if (quantityChanged || productIdChanged) {
      if (oldSale.productId || oldSale.product) {
        const oldProduct = await resolveInventoryProduct(req, oldSale.productId, oldSale.product);
        if (oldProduct) {
          const restored = await restoreProductStock(oldProduct, oldSale.quantity);
          if (restored) await broadcastScopeChange(req, 'product:updated', restored);
        }
      }

      const newProductId = updateData.productId || oldSale.productId;
      const newProductName = updateData.product || oldSale.product;
      const newProduct = await resolveInventoryProduct(req, newProductId, newProductName);
      if (newProduct) {
        const newQuantity = updateData.quantity !== undefined ? updateData.quantity : oldSale.quantity;
        if (newQuantity > (newProduct.stock ?? 0)) {
          return res.status(400).json({
            error: `Insufficient stock for ${newProduct.name}. Only ${newProduct.stock ?? 0} available.`,
          });
        }
        const updated = await deductProductStock(newProduct, newQuantity);
        if (updated) await broadcastScopeChange(req, 'product:updated', updated);
        updateData.productId = newProduct._id;
      }
    }

    if (updateData.revenue != null || updateData.cost != null) {
      const revenue =
        updateData.revenue != null ? Number(updateData.revenue) : Number(oldSale.revenue) || 0;
      const cost =
        updateData.cost != null ? Number(updateData.cost) : Number(oldSale.cost) || 0;
      const profit = revenue - cost;
      updateData.profit = Math.abs(profit) < 0.005 ? 0 : Math.round(profit * 100) / 100;
    }

    const sale = await Sale.findOneAndUpdate(
      buildListQuery(req, { _id: req.params.id }),
      updateData,
      { new: true, runValidators: true }
    )
      .populate('serviceId', 'name category');

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    await broadcastScopeChange(req, 'sale:updated', sale);

    res.json({ 
      message: 'Sale updated successfully',
      data: sale 
    });
  } catch (error) {
    console.error('Update sale error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    handleScopeError(res, error);
  }
};

export const deleteSale = async (req, res) => {
  try {
    // Workspace: only admins/owners or members with the sales permission can delete.
    assertPageAccess(req, 'sales');
    const userId = getUserId(req);

    const sale = await Sale.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    if (sale.productId || sale.product) {
      const product = await resolveInventoryProduct(req, sale.productId, sale.product);
      if (product) {
        const restored = await restoreProductStock(product, sale.quantity);
        if (restored) await broadcastScopeChange(req, 'product:updated', restored);
      }
    }

    await Sale.findByIdAndDelete(req.params.id);

    await broadcastScopeChange(req, 'sale:deleted', { _id: sale._id, workspaceId: sale.workspaceId });

    res.json({ 
      message: 'Sale deleted successfully',
      data: sale 
    });
  } catch (error) {
    console.error('Delete sale error:', error);
    handleScopeError(res, error);
  }
};

export const deleteAllSales = async (req, res) => {
  try {
    assertPageAccess(req, 'sales');
    const userId = getUserId(req);
    const scopeQuery = buildListQuery(req);
    const allSales = await Sale.find(scopeQuery);
    
    const stockRestorations = new Map();
    for (const sale of allSales) {
      if (sale.productId) {
        const productId = sale.productId.toString();
        const currentQuantity = stockRestorations.get(productId) || 0;
        stockRestorations.set(productId, currentQuantity + sale.quantity);
      }
    }

    for (const [productId, totalQuantity] of stockRestorations.entries()) {
      try {
        const product = await Product.findOne(buildListQuery(req, { _id: productId }));
        if (product) {
          await restoreProductStock(product, totalQuantity);
        }
      } catch (error) {
        console.error(`Error restoring stock for product ${productId}:`, error);
      }
    }

    const result = await Sale.deleteMany(scopeQuery);
    
    res.json({ 
      message: `Successfully deleted ${result.deletedCount} sale(s)`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Delete all sales error:', error);
    handleScopeError(res, error);
  }
};
