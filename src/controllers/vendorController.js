import Vendor from '../models/Vendor.js';
import Bill from '../models/Bill.js';
import Expense from '../models/Expense.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

export const getVendors = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const vendors = await Vendor.find(buildListQuery(req)).sort({ createdAt: -1 });
    res.json({ data: vendors });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    handleScopeError(res, error);
  }
};

export const getVendor = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const vendor = await Vendor.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    res.json({ data: vendor });
  } catch (error) {
    console.error('Error fetching vendor:', error);
    handleScopeError(res, error);
  }
};

export const createVendor = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { name, email, phone, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Vendor name is required' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const vendor = new Vendor({
      name: name.trim(),
      email: email ? email.trim().toLowerCase() : undefined,
      phone: phone ? phone.trim() : undefined,
      notes: notes ? notes.trim() : undefined,
      ...buildCreateScope(req),
    });

    await vendor.save();
    res.status(201).json({ data: vendor });
  } catch (error) {
    console.error('Error creating vendor:', error);
    handleScopeError(res, error);
  }
};

export const updateVendor = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const { name, email, phone, notes } = req.body;

    const vendor = await Vendor.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    if (name !== undefined) vendor.name = name.trim();
    if (email !== undefined) {
      const normalizedEmail = email ? email.trim() : '';
      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }
      vendor.email = normalizedEmail ? normalizedEmail.toLowerCase() : undefined;
    }
    if (phone !== undefined) vendor.phone = phone ? phone.trim() : undefined;
    if (notes !== undefined) vendor.notes = notes ? notes.trim() : undefined;

    await vendor.save();
    res.json({ data: vendor });
  } catch (error) {
    console.error('Error updating vendor:', error);
    handleScopeError(res, error);
  }
};

export const deleteVendor = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const vendor = await Vendor.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    res.json({ message: 'Vendor deleted successfully' });
  } catch (error) {
    console.error('Error deleting vendor:', error);
    handleScopeError(res, error);
  }
};

export const getVendorActivity = async (req, res) => {
  try {
    assertPageAccess(req, 'finance');
    const scope = buildListQuery(req);
    const vendor = await Vendor.findOne({ ...scope, _id: req.params.id });
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    const [bills, expenses] = await Promise.all([
      Bill.find({ ...scope, vendorId: vendor._id }).sort({ dueDate: -1 }).lean(),
      Expense.find({ ...scope, vendorId: vendor._id }).sort({ date: -1 }).lean(),
    ]);

    const outstanding = bills
      .filter((bill) => bill.status === 'pending')
      .reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);

    const paidBills = bills
      .filter((bill) => bill.status === 'paid')
      .reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);

    const directExpenses = expenses.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const totalPaid = paidBills + directExpenses;

    res.json({
      data: {
        vendor,
        bills,
        expenses,
        outstanding,
        totalPaid,
      },
    });
  } catch (error) {
    console.error('Error fetching vendor activity:', error);
    handleScopeError(res, error);
  }
};
