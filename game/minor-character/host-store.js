import { readMinorCampaign } from "./read.js";
export function hostStore(store, metadata) {
    async function entry(binding) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(binding));
        const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        return { namespace: 'minor-character', key: `${key}-m25` };
    }
    return {
        async load(binding) {
            const target = metadata(binding);
            const result = await store.tryGetJson(await entry(binding));
            if (!result.found)
                return undefined;
            const campaign = readMinorCampaign(result.value, binding);
            await target.setExtension({ namespace: 'minor-character', value: {
                    campaignId: campaign.id, branchId: campaign.branchId, revision: campaign.revision, binding,
                } });
            return campaign;
        },
        async save(binding, campaign) {
            const target = metadata(binding);
            await store.setJson({ ...await entry(binding), value: campaign });
            await target.setExtension({ namespace: 'minor-character', value: {
                    campaignId: campaign.id, branchId: campaign.branchId, revision: campaign.revision, binding,
                } });
        },
    };
}
