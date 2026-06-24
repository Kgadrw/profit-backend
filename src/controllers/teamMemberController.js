import TeamMember from '../models/TeamMember.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

export const getTeamMembers = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const { status, department } = req.query;
    const query = buildListQuery(req);
    if (status) query.status = status;
    if (department) query.department = department;

    const members = await TeamMember.find(query).sort({ name: 1 });
    res.json({ data: members });
  } catch (error) {
    console.error('Error fetching team members:', error);
    handleScopeError(res, error);
  }
};

export const getTeamMember = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const member = await TeamMember.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!member) return res.status(404).json({ error: 'Team member not found' });

    res.json({ data: member });
  } catch (error) {
    console.error('Error fetching team member:', error);
    handleScopeError(res, error);
  }
};

export const createTeamMember = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const { name, email, phone, jobTitle, department, status, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const member = await TeamMember.create({
      ...buildCreateScope(req),
      name: name.trim(),
      email: email?.trim().toLowerCase() || '',
      phone: phone?.trim() || '',
      jobTitle: jobTitle?.trim() || '',
      department: department || 'general',
      status: status || 'active',
      notes: notes?.trim() || '',
    });

    res.status(201).json({ data: member });
  } catch (error) {
    console.error('Error creating team member:', error);
    handleScopeError(res, error);
  }
};

export const updateTeamMember = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const member = await TeamMember.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!member) return res.status(404).json({ error: 'Team member not found' });

    const fields = ['name', 'email', 'phone', 'jobTitle', 'department', 'status', 'notes'];
    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'email' && req.body.email) {
        member.email = String(req.body.email).trim().toLowerCase();
      } else if (typeof req.body[field] === 'string') {
        member[field] = req.body[field].trim();
      } else {
        member[field] = req.body[field];
      }
    }

    await member.save();
    res.json({ data: member });
  } catch (error) {
    console.error('Error updating team member:', error);
    handleScopeError(res, error);
  }
};

export const deleteTeamMember = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const member = await TeamMember.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!member) return res.status(404).json({ error: 'Team member not found' });

    res.json({ message: 'Team member deleted', data: member });
  } catch (error) {
    console.error('Error deleting team member:', error);
    handleScopeError(res, error);
  }
};
