import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Download,
  Filter,
  MapPin,
  Plus,
  Printer,
  Save,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, fetchAuthorizedResponse } from '../utils/api.ts';
import type {
  CaseCategoryDef,
  CasePriority,
  CaseStatus,
  CaseSummary,
  FullCaseData,
} from '../types/forensics.ts';

interface InvestigatorOption {
  id: string;
  displayName: string;
  email: string;
  role: string;
  department: string;
  badgeId: string;
}

interface InvestigationRegisterProps {
  casesList: CaseSummary[];
  activeCaseData: FullCaseData | null;
  categories: CaseCategoryDef[];
  canCreateCase: boolean;
  canEditCase: boolean;
  canAssign: boolean;
  onSelectCase: (caseId: string) => Promise<void> | void;
  onOpenInLab: (caseId: string) => void;
  onRefreshCases: (filters?: {
    q?: string;
    risk?: string;
    category?: string;
    status?: string;
    priority?: string;
    sort?: string;
    assigned?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => Promise<void>;
  onCaseUpdated: (updated: FullCaseData) => void;
}

const ALL_STATUSES: CaseStatus[] = [
  'draft',
  'registered',
  'under_review',
  'assigned',
  'investigation_in_progress',
  'evidence_collection',
  'forensic_analysis',
  'awaiting_verification',
  'escalated',
  'resolved',
  'closed',
  'archived',
];

const ALL_PRIORITIES: CasePriority[] = ['low', 'medium', 'high', 'critical'];

export const InvestigationRegister: React.FC<InvestigationRegisterProps> = ({
  casesList,
  activeCaseData,
  categories,
  canCreateCase,
  canEditCase,
  canAssign,
  onSelectCase,
  onOpenInLab,
  onRefreshCases,
  onCaseUpdated,
}) => {
  // Register filters
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('All');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [sortBy, setSortBy] = useState('updated_desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Investigators for assignment
  const [investigators, setInvestigators] = useState<InvestigatorOption[]>([]);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState<
    'investigator' | 'senior_investigator' | 'evidence_officer' | 'viewer'
  >('investigator');
  const [assignBusy, setAssignBusy] = useState(false);

  // Dossier editor state synced with activeCaseData
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [editStatus, setEditStatus] = useState<CaseStatus>('registered');
  const [editPriority, setEditPriority] = useState<CasePriority>('medium');
  const [editLocation, setEditLocation] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editClosingSummary, setEditClosingSummary] = useState('');
  const [editCategoryFields, setEditCategoryFields] = useState<Record<string, string>>({});
  const [editRelatedPersons, setEditRelatedPersons] = useState<Array<{ name: string; role: string }>>([]);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonRole, setNewPersonRole] = useState('Subject / Person of Interest');
  const [savingDossier, setSavingDossier] = useState(false);

  // New Registration modal inside Register
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCat, setNewCat] = useState('general');
  const [newPriority, setNewPriority] = useState<CasePriority>('medium');
  const [newLocation, setNewLocation] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newCaption, setNewCaption] = useState('');
  const [newCatFields, setNewCatFields] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAssign) return;
    apiRequest<{ investigators: InvestigatorOption[] }>('/api/investigators')
      .then((res) => setInvestigators(Array.isArray(res.investigators) ? res.investigators : []))
      .catch(() => {});
  }, [canAssign]);

  useEffect(() => {
    if (!activeCaseData?.case) return;
    const c = activeCaseData.case;
    setEditTitle(c.title || '');
    setEditDescription(c.description || '');
    setEditCategory(c.category || 'general');
    setEditStatus((c.status as CaseStatus) || 'registered');
    setEditPriority((c.priority as CasePriority) || 'medium');
    setEditLocation(c.incidentLocation || '');
    setEditDate(c.incidentDate || '');
    setEditNotes(c.notes || '');
    setEditClosingSummary(c.closingSummary || '');
    setEditCategoryFields({ ...(c.categoryFields ?? {}) });
    setEditRelatedPersons(Array.isArray(c.relatedPersons) ? c.relatedPersons : []);
    setAssignUserId(c.assignedInvestigatorId || '');
  }, [activeCaseData]);

  const activeCategoryDef = useMemo(
    () => categories.find((c) => c.slug === editCategory) || activeCaseData?.categoryMeta || null,
    [categories, editCategory, activeCaseData?.categoryMeta],
  );

  const newCategoryDef = useMemo(
    () => categories.find((c) => c.slug === newCat) || null,
    [categories, newCat],
  );

  const applyFilters = (overrides?: Partial<Record<string, string>>) => {
    onRefreshCases({
      q: overrides?.q ?? q,
      status: overrides?.status ?? statusFilter,
      priority: overrides?.priority ?? priorityFilter,
      category: overrides?.category ?? categoryFilter,
      risk: overrides?.risk ?? riskFilter,
      assigned: overrides?.assigned ?? assignedFilter,
      sort: overrides?.sort ?? sortBy,
      dateFrom: overrides?.dateFrom ?? dateFrom,
      dateTo: overrides?.dateTo ?? dateTo,
    });
  };

  const handleExportCsv = async () => {
    setError(null);
    try {
      const res = await fetchAuthorizedResponse('/api/cases/export/csv');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'TruthLens_Investigation_Register.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export CSV register.');
    }
  };

  const handleSaveDossier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCaseData?.case?.id) return;
    setSavingDossier(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiRequest<FullCaseData>(`/api/cases/${activeCaseData.case.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          category: editCategory,
          status: editStatus,
          priority: editPriority,
          incidentLocation: editLocation,
          incidentDate: editDate,
          notes: editNotes,
          closingSummary: editClosingSummary,
          relatedPersons: editRelatedPersons,
          categoryFields: editCategoryFields,
        }),
      });
      onCaseUpdated(updated);
      await onRefreshCases();
      setNotice('Investigation register dossier updated and logged to timeline.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update case details.');
    } finally {
      setSavingDossier(false);
    }
  };

  const handleAssignInvestigator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCaseData?.case?.id || !assignUserId) return;
    setAssignBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiRequest<FullCaseData>(
        `/api/cases/${activeCaseData.case.id}/assign`,
        {
          method: 'POST',
          body: JSON.stringify({ investigatorId: assignUserId, accessRole: assignRole }),
        },
      );
      onCaseUpdated(updated);
      await onRefreshCases();
      setNotice('Investigator assigned with email & real-time in-app notification.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to assign investigator.');
    } finally {
      setAssignBusy(false);
    }
  };

  const handleRegisterNewCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await apiRequest<FullCaseData>('/api/cases', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          description: newDesc,
          category: newCat,
          priority: newPriority,
          incidentLocation: newLocation,
          incidentDate: newDate,
          captionText: newCaption,
          categoryFields: newCatFields,
        }),
      });
      setShowRegisterModal(false);
      setNewTitle('');
      setNewDesc('');
      setNewLocation('');
      setNewDate('');
      setNewCaption('');
      setNewCatFields({});
      onCaseUpdated(created);
      await onRefreshCases();
      setNotice(`Registered new investigation ${created.case.caseNumber || created.case.id.slice(0, 8)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register investigation.');
    } finally {
      setCreating(false);
    }
  };

  const safeCases = Array.isArray(casesList) ? casesList : [];

  return (
    <div className="space-y-6">
      {/* Filter & Register Toolbar */}
      <section className="glass-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
              Digital Investigation Register
            </div>
            <h2 className="font-display text-lg font-bold text-white">
              Multi-Category Case Registry, Assignment &amp; Lifecycle Management
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-xs text-slate-200 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-cyan-400" />
              <span>Print Register</span>
            </button>
            {canCreateCase && (
              <button
                type="button"
                onClick={() => setShowRegisterModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Registration</span>
              </button>
            )}
          </div>
        </div>

        {/* Multi-filter Controls */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs pt-2 border-t border-slate-800/80 no-print">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                applyFilters({ q: e.target.value });
              }}
              placeholder="Search case #, title, location..."
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              applyFilters({ category: e.target.value });
            }}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
          >
            <option value="all">All Categories ({categories.length})</option>
            {categories.map((cat) => (
              <option key={cat.slug} value={cat.slug}>
                {cat.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              applyFilters({ status: e.target.value });
            }}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
          >
            <option value="all">All 12 Statuses</option>
            {ALL_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st.replace(/_/g, ' ')}
              </option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value);
              applyFilters({ priority: e.target.value });
            }}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
          >
            <option value="all">All Priorities</option>
            {ALL_PRIORITIES.map((pr) => (
              <option key={pr} value={pr}>
                Priority: {pr.toUpperCase()}
              </option>
            ))}
          </select>

          <select
            value={riskFilter}
            onChange={(e) => {
              setRiskFilter(e.target.value);
              applyFilters({ risk: e.target.value });
            }}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
          >
            <option value="All">Forensic Risk: All</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          <select
            value={assignedFilter}
            onChange={(e) => {
              setAssignedFilter(e.target.value);
              applyFilters({ assigned: e.target.value });
            }}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
          >
            <option value="all">Assignment: Anyone</option>
            <option value="me">Assigned to Me</option>
            <option value="unassigned">Unassigned Only</option>
          </select>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                applyFilters({ dateFrom: e.target.value });
              }}
              aria-label="Filter from date"
              className="flex-1 px-2 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
            />
            <span className="text-slate-500">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                applyFilters({ dateTo: e.target.value });
              }}
              aria-label="Filter to date"
              className="flex-1 px-2 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value);
              applyFilters({ sort: e.target.value });
            }}
            className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
          >
            <option value="updated_desc">Sort: Recently Updated</option>
            <option value="created_desc">Sort: Newly Registered</option>
            <option value="priority_desc">Sort: Highest Priority</option>
            <option value="risk_desc">Sort: Highest Risk Score</option>
          </select>
        </div>

        {/* Register Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800/90">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[11px]">
              <tr>
                <th className="px-3.5 py-2.5">Case #</th>
                <th className="px-3.5 py-2.5">Title &amp; Category</th>
                <th className="px-3.5 py-2.5">Status</th>
                <th className="px-3.5 py-2.5">Priority</th>
                <th className="px-3.5 py-2.5">Assigned</th>
                <th className="px-3.5 py-2.5">Risk</th>
                <th className="px-3.5 py-2.5 text-right no-print">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {safeCases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    No investigations match the selected filters.
                  </td>
                </tr>
              ) : (
                safeCases.map((c) => {
                  const isActive = c.id === activeCaseData?.case?.id;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onSelectCase(c.id)}
                      className={`cursor-pointer transition-colors ${
                        isActive ? 'bg-cyan-500/10' : 'hover:bg-slate-900/50'
                      }`}
                    >
                      <td className="px-3.5 py-3 font-mono text-cyan-300 font-semibold whitespace-nowrap">
                        {c.caseNumber || c.id.slice(0, 8)}
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="text-white font-medium">{c.title}</div>
                        <div className="text-[11px] text-slate-400">
                          {c.category || 'general'}
                          {c.incidentLocation ? ` · ${c.incidentLocation}` : ''}
                        </div>
                      </td>
                      <td className="px-3.5 py-3 capitalize text-slate-200 whitespace-nowrap">
                        {(c.status || 'registered').replace(/_/g, ' ')}
                      </td>
                      <td className="px-3.5 py-3 uppercase font-mono whitespace-nowrap">
                        <span
                          className={
                            c.priority === 'critical'
                              ? 'text-rose-300 font-semibold'
                              : c.priority === 'high'
                                ? 'text-amber-300'
                                : c.priority === 'medium'
                                  ? 'text-cyan-300'
                                  : 'text-emerald-300'
                          }
                        >
                          {c.priority || 'medium'}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 text-slate-300 whitespace-nowrap">
                        {c.assignedInvestigatorName || 'Unassigned'}
                      </td>
                      <td className="px-3.5 py-3 font-mono whitespace-nowrap">
                        {c.riskLevel} ({c.confidenceMin}–{c.confidenceMax}%)
                      </td>
                      <td className="px-3.5 py-3 text-right no-print">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCase(c.id);
                            onOpenInLab(c.id);
                          }}
                          className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:border-cyan-500 text-[11px] text-cyan-300 cursor-pointer"
                        >
                          Evidence Lab
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {notice && (
        <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/35 px-4 py-2.5 text-xs text-emerald-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-2.5 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Selected Case Register Dossier & Investigator Assignment */}
      {activeCaseData?.case && (
        <div className="grid lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSaveDossier}
            className="lg:col-span-8 glass-panel rounded-xl p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div className="text-xs font-mono text-cyan-400">
                  {activeCaseData.case.caseNumber || activeCaseData.case.id.slice(0, 8)}
                </div>
                <h3 className="text-base font-semibold text-white">
                  Case File Metadata, Category Schema &amp; Closing Summary
                </h3>
              </div>
              {canEditCase && (
                <button
                  type="submit"
                  disabled={savingDossier}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingDossier ? 'Saving...' : 'Save Register Record'}</span>
                </button>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">Investigation Title</label>
                <input
                  type="text"
                  required
                  disabled={!canEditCase}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Category</label>
                <select
                  disabled={!canEditCase}
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                >
                  {categories.map((cat) => (
                    <option key={cat.slug} value={cat.slug}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Status (12 stages)</label>
                  <select
                    disabled={!canEditCase}
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as CaseStatus)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  >
                    {ALL_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Priority</label>
                  <select
                    disabled={!canEditCase}
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as CasePriority)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  >
                    {ALL_PRIORITIES.map((pr) => (
                      <option key={pr} value={pr}>
                        {pr.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  <MapPin className="w-3 h-3 inline mr-1" />
                  Incident Location
                </label>
                <input
                  type="text"
                  disabled={!canEditCase}
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  placeholder="City / Jurisdiction / Sector"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Incident Date / Time</label>
                <input
                  type="text"
                  disabled={!canEditCase}
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  placeholder="YYYY-MM-DD HH:MM UTC"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-slate-400 mb-1">Case Description</label>
                <textarea
                  rows={2}
                  disabled={!canEditCase}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
            </div>

            {/* Category-Specific Dynamic Fields */}
            {activeCategoryDef && activeCategoryDef.fields.length > 0 && (
              <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-cyan-200 flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{activeCategoryDef.name} — Specific Fields</span>
                  </span>
                  {activeCategoryDef.evidenceRequirements.length > 0 && (
                    <span className="text-[11px] text-slate-400">
                      Recommended: {activeCategoryDef.evidenceRequirements.slice(0, 2).join(', ')}
                    </span>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  {activeCategoryDef.fields.map((fld) => (
                    <div key={fld.key}>
                      <label className="block text-slate-400 mb-1">{fld.label}</label>
                      {fld.type === 'select' && Array.isArray(fld.options) ? (
                        <select
                          disabled={!canEditCase}
                          value={editCategoryFields[fld.key] ?? ''}
                          onChange={(e) =>
                            setEditCategoryFields((prev) => ({
                              ...prev,
                              [fld.key]: e.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                        >
                          <option value="">Select...</option>
                          {fld.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={fld.type === 'date' ? 'date' : 'text'}
                          disabled={!canEditCase}
                          value={editCategoryFields[fld.key] ?? ''}
                          onChange={(e) =>
                            setEditCategoryFields((prev) => ({
                              ...prev,
                              [fld.key]: e.target.value,
                            }))
                          }
                          placeholder={fld.placeholder || ''}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related Persons */}
            <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-4 space-y-2.5 text-xs">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-violet-400" />
                <span>Related Persons / Entities</span>
              </div>
              {editRelatedPersons.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {editRelatedPersons.map((p, idx) => (
                    <span
                      key={`${p.name}-${idx}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200"
                    >
                      <span>
                        {p.name} <span className="text-slate-400">({p.role})</span>
                      </span>
                      {canEditCase && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditRelatedPersons((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-slate-400 hover:text-rose-300 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {canEditCase && (
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    placeholder="Person / Entity name"
                    className="flex-1 min-w-[150px] px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                  <input
                    type="text"
                    value={newPersonRole}
                    onChange={(e) => setNewPersonRole(e.target.value)}
                    placeholder="Role (e.g. Complainant, Channel Admin)"
                    className="flex-1 min-w-[150px] px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newPersonName.trim()) return;
                      setEditRelatedPersons((prev) => [
                        ...prev,
                        { name: newPersonName.trim(), role: newPersonRole.trim() || 'Subject' },
                      ]);
                      setNewPersonName('');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-500 text-slate-200 cursor-pointer"
                  >
                    Add Person
                  </button>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Investigator Field Notes</label>
                <textarea
                  rows={3}
                  disabled={!canEditCase}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Internal handling notes, verification leads..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">
                  Closing / Resolution Summary (for resolved/closed cases)
                </label>
                <textarea
                  rows={3}
                  disabled={!canEditCase}
                  value={editClosingSummary}
                  onChange={(e) => setEditClosingSummary(e.target.value)}
                  placeholder="Final investigation disposition & findings overview..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>
            </div>
          </form>

          {/* Right Column: Investigator Assignment & Category Guidance */}
          <div className="lg:col-span-4 space-y-5">
            <div className="glass-panel rounded-xl p-5 space-y-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-white">
                <UserPlus className="w-4 h-4 text-cyan-400" />
                <span>Investigator Assignment</span>
              </div>
              <div className="rounded-lg bg-slate-950 border border-slate-800 p-3 space-y-1">
                <div className="text-slate-400">Current Lead Investigator</div>
                <div className="text-sm font-semibold text-cyan-200">
                  {activeCaseData.case.assignedInvestigator?.displayName || 'Unassigned'}
                </div>
                {activeCaseData.case.assignedInvestigator && (
                  <div className="text-[11px] font-mono text-slate-400">
                    {activeCaseData.case.assignedInvestigator.email} ·{' '}
                    {activeCaseData.case.assignedInvestigator.role.replace(/_/g, ' ')}
                  </div>
                )}
              </div>

              {canAssign ? (
                <form onSubmit={handleAssignInvestigator} className="space-y-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Select Staff Member</label>
                    <select
                      required
                      value={assignUserId}
                      onChange={(e) => setAssignUserId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                    >
                      <option value="">Choose investigator...</option>
                      {investigators.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.displayName} ({inv.role.replace(/_/g, ' ')})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Case Access Level</label>
                    <select
                      value={assignRole}
                      onChange={(e) => setAssignRole(e.target.value as typeof assignRole)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                    >
                      <option value="investigator">Investigator (Read/Write)</option>
                      <option value="senior_investigator">Senior Investigator</option>
                      <option value="evidence_officer">Evidence Officer</option>
                      <option value="viewer">Viewer (Read-Only)</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={assignBusy || !assignUserId}
                    className="w-full py-2 px-4 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {assignBusy ? 'Assigning...' : 'Assign & Notify Investigator'}
                  </button>
                </form>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Senior investigator or administrator role required to assign or reassign staff.
                </p>
              )}
            </div>

            {activeCategoryDef && (
              <div className="glass-panel rounded-xl p-5 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Briefcase className="w-4 h-4 text-violet-400" />
                  <span>{activeCategoryDef.name} Checklist</span>
                </div>
                <p className="text-slate-400 leading-relaxed">{activeCategoryDef.description}</p>
                {activeCategoryDef.evidenceRequirements.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-mono text-slate-400 uppercase">
                      Recommended Evidence
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-slate-300">
                      {activeCategoryDef.evidenceRequirements.map((req, idx) => (
                        <li key={idx}>{req}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {activeCategoryDef.reportTemplateNote && (
                  <div className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-[11px] text-slate-300">
                    <strong className="text-cyan-300">Protocol Note:</strong>{' '}
                    {activeCategoryDef.reportTemplateNote}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Register New Case Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl glass-panel rounded-2xl p-6 space-y-4 my-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-white">
                Register New Digital Investigation
              </h2>
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterNewCase} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">Investigation Title *</label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Executive Voice Clone Wire Transfer Attempt"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">Category (20+ defaults)</label>
                  <select
                    value={newCat}
                    onChange={(e) => {
                      setNewCat(e.target.value);
                      setNewCatFields({});
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  >
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as CasePriority)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                  >
                    {ALL_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">Incident Location</label>
                  <input
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="City / Platform / Jurisdiction"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Incident Date</label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
              </div>

              {newCategoryDef && newCategoryDef.fields.length > 0 && (
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2">
                  <div className="font-mono text-[11px] text-cyan-300">
                    {newCategoryDef.name} Fields
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    {newCategoryDef.fields.map((fld) => (
                      <div key={fld.key}>
                        <label className="block text-slate-400 mb-1">{fld.label}</label>
                        <input
                          type={fld.type === 'date' ? 'date' : 'text'}
                          value={newCatFields[fld.key] ?? ''}
                          onChange={(e) =>
                            setNewCatFields((prev) => ({ ...prev, [fld.key]: e.target.value }))
                          }
                          placeholder={fld.placeholder || ''}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-300 mb-1">Context / Summary</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Initial complaint or submission source..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Claim / Caption Statement</label>
                <textarea
                  rows={3}
                  value={newCaption}
                  onChange={(e) => setNewCaption(e.target.value)}
                  placeholder="Paste suspect social caption, transcript, or alleged statement..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 font-semibold cursor-pointer disabled:opacity-50"
                >
                  {creating ? 'Registering...' : 'Register Investigation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
