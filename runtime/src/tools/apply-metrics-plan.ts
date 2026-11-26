import { z } from 'zod';
import { ok, requireCloudLibrary, type ToolDefinition } from '../registry/registry.js';
import { executeMetricsPlan, readMetricsPlan } from '../features/metrics-plan.js';

const applyMetricsPlan: ToolDefinition = {
  name: 'zotero_apply_metrics_plan', title: 'Dry-run or apply an approved Zotero metrics plan',
  description: 'Apply a reviewed IF/JCR/CAS metrics plan. It preserves non-AI4S Extra text and unrelated tags, replaces only the same metric year, and derives current JCR:/CAS: tags from the highest available metric year. Dry-run never writes to Zotero; apply requires the exact plan hash, a receipt path, and Web API credentials. Local-API provenance or a tenfold version-scale gap triggers a refresh directly from api.zotero.org. The result includes original_plan_hash, a new plan_hash, and refreshed_plan. Save and dry-run the refreshed plan, review it, and confirm its new hash before apply; a refresh during apply blocks that call without writes. Genuine cloud-version changes (including HTTP 412) remain conflicts.',
  inputSchema: { plan_path:z.string().min(1), mode:z.enum(['dry_run','apply']), confirm_plan_hash:z.string().optional(), receipt_path:z.string().optional(), library_type:z.enum(['user','group']).optional(), library_id:z.number().int().optional() },
  annotations: { readOnlyHint:false, idempotentHint:true, openWorldHint:true },
  handler: async (args, ctx) => {
    const plan = await readMetricsPlan(args.plan_path); const lib = requireCloudLibrary(ctx, args);
    if (lib.type !== plan.target.library_type || lib.id !== plan.target.library_id) throw new Error('Plan target does not match selected Zotero library');
    if (args.mode === 'apply') { if (!ctx.web.canWrite || !ctx.web.isCloud) throw new Error('Metrics plans require a Zotero cloud Web API key; desktop local versions cannot be used as cloud versions. Call setup_status.'); if (args.confirm_plan_hash !== plan.plan_hash) throw new Error('Apply requires confirm_plan_hash exactly matching plan_hash'); if (!args.receipt_path) throw new Error('Apply requires receipt_path'); }
    const result = await executeMetricsPlan(ctx, plan, lib, args.mode, args.receipt_path);
    return ok({ ...result }, `${args.mode === 'dry_run' ? 'Metrics dry run' : 'Metrics apply'} ${result.status}. ${result.version_refreshes} local/cloud version refresh(es); ${result.conflict_summary.cloud_version_moved} cloud-version-moved conflict(s). ${result.message ?? ''}`);
  },
};
export default applyMetricsPlan;
