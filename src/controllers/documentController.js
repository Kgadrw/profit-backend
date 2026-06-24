import CompanyDocument from '../models/CompanyDocument.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { deleteStoredFileByUrl } from '../utils/storedFileService.js';

const normalizeDocumentDate = (value) => {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
};

export const getDocuments = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const { startDate, endDate } = req.query;
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

    const documents = await CompanyDocument.find(query).sort({ date: -1, createdAt: -1 });
    res.json({ data: documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    handleScopeError(res, error);
  }
};

export const getDocument = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ data: document });
  } catch (error) {
    console.error('Error fetching document:', error);
    handleScopeError(res, error);
  }
};

export const createDocument = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const { title, category, date, note, fileUrl, fileName, fileSize } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ error: 'Document title is required' });
    }
    if (!fileUrl || !fileName) {
      return res.status(400).json({ error: 'Document file is required' });
    }

    const document = new CompanyDocument({
      title: title.trim(),
      category: category ? category.trim() : 'general',
      date: normalizeDocumentDate(date),
      note: note ? note.trim() : undefined,
      fileUrl,
      fileName,
      fileSize: fileSize !== undefined ? Number(fileSize) : undefined,
      ...buildCreateScope(req),
    });

    await document.save();
    res.status(201).json({ data: document });
  } catch (error) {
    console.error('Error creating document:', error);
    handleScopeError(res, error);
  }
};

export const updateDocument = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const { title, category, date, note, fileUrl, fileName, fileSize } = req.body;

    if (title !== undefined) document.title = title.trim();
    if (category !== undefined) document.category = category ? category.trim() : 'general';
    if (date !== undefined) document.date = normalizeDocumentDate(date);
    if (note !== undefined) document.note = note ? note.trim() : undefined;
    if (fileUrl !== undefined) document.fileUrl = fileUrl || undefined;
    if (fileName !== undefined) document.fileName = fileName || undefined;
    if (fileSize !== undefined) document.fileSize = fileSize !== null ? Number(fileSize) : undefined;

    await document.save();
    res.json({ data: document });
  } catch (error) {
    console.error('Error updating document:', error);
    handleScopeError(res, error);
  }
};

export const deleteDocument = async (req, res) => {
  try {
    assertPageAccess(req, 'documents');
    const document = await CompanyDocument.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.fileUrl) {
      await deleteStoredFileByUrl(document.fileUrl);
    }

    res.json({ message: 'Document deleted' });
  } catch (error) {
    console.error('Error deleting document:', error);
    handleScopeError(res, error);
  }
};
