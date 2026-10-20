import { currentMemoryPublications } from "./memory-publication.js";
import { projectSheet } from "./sheet.js";
import { projectProfile } from "./profile-views.js";
import { listEditableFields } from "./editing.js";
import { projectDeclaration, projectProposal, projectTriage } from "./proposals.js";
export function projectPlayer(campaign) {
    const state = campaign.snapshot.state;
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const play = state.classState.find(entry => entry.characterId === state.playerCharacterId);
    return {
        context: { campaignId: campaign.id, branchId: campaign.branchId, revision: campaign.revision },
        memoryBindings: {
            canonical: state.memoryBindings.canonical === null ? null
                : { backend: state.memoryBindings.canonical.backend, id: state.memoryBindings.canonical.id },
            people: state.memoryBindings.people.map(({ personId, backend, bookId }) => ({ personId, backend, bookId })),
        },
        profiles: state.profiles.map(profile => projectProfile(state, profile.personId, 'player')),
        characterId: state.playerCharacterId, character: projectCharacter(character), sheet: projectSheet(state),
        play: { manifestedElement: play.manifestedElement, activeClassId: play.activeClassId,
            switchesThisScene: play.switchesThisScene, nextSwitchCost: play.switchesThisScene + 1,
            scene: { id: state.world.scene.id, number: state.world.scene.number, startAnchor: {
                    binding: state.world.scene.startAnchor.binding, nextMessageIndex: state.world.scene.startAnchor.nextMessageIndex,
                    prefixFingerprint: state.world.scene.startAnchor.prefixFingerprint,
                } },
            cards: play.classes.map(card => ({ id: card.id, name: card.name, tier: card.tier,
                competence: card.competence.map(({ skillId, bonus }) => ({ skillId, bonus })),
                ...(card.sourceClassIds === undefined ? {} : { sourceClassIds: [...card.sourceClassIds] }),
            })),
        },
        editableFields: listEditableFields({ ...state, characters: [character], classState: [play] }).map(({ ref, label, value, choices }) => ({
            ref: { owner: ref.owner, entityId: ref.entityId, field: ref.field,
                ...(ref.box === undefined ? {} : { box: ref.box }) }, label, value,
            ...(choices === undefined ? {} : { choices: [...choices] }),
        })),
        campaignDetails: {
            mysteries: state.world.mysteries.map(({ id, question, discoveries, truth }) => ({ id, question, truth,
                discoveries: discoveries.map(({ id, name }) => ({ id, name })) })),
            threads: state.world.threads.map(({ id, name }) => ({ id, name })),
            characters: state.world.characters.map(({ id, name }) => ({ id, name })),
            knives: state.world.knives.map(({ id, name, beat, status }) => ({ id, name, beat, status })),
        },
        history: projectHistory(campaign),
        proposal: state.proposal ? projectProposal(state.proposal) : null,
        turns: projectTurns(campaign),
        pendingManual: state.pending?.operationId ?? null, sceneReview: projectSceneReview(state),
        memoryPublications: projectMemoryPublicationStatus(state),
        rules: { gameId: campaign.rules.gameId, revision: campaign.rules.revision }, opening: state.world.opening,
        bankedTwists: (state.bankedTwists ?? []).map(twist => ({
            id: twist.id,
            sceneId: twist.sceneId,
            operationId: twist.operationId,
            description: twist.description,
            spent: twist.spent,
            ...(twist.spentNote === undefined ? {} : { spentNote: twist.spentNote }),
        })),
        exposureLog: (state.exposureLog ?? []).map(inc => ({
            id: inc.id,
            witness: inc.witness,
            description: inc.description,
            absorbedByCub: inc.absorbedByCub,
            threshold: inc.threshold,
            learnedFact: inc.learnedFact,
        })),
        milestoneAllowance: {
            minorThisSession: state.milestoneAllowance?.minorThisSession ?? 0,
            majorThisArc: state.milestoneAllowance?.majorThisArc ?? 0,
        },
        coreDevelopments: {
            confluence: state.coreDevelopments?.confluence ?? false,
            awakening: state.coreDevelopments?.awakening ?? false,
            awakeningUsedThisArc: state.coreDevelopments?.awakeningUsedThisArc ?? false,
            awakeningActiveSceneId: state.coreDevelopments?.awakeningActiveSceneId ?? null,
        },
        encounters: {
            hazards: (state.encounters?.hazards ?? state.hazards ?? []).map(h => ({
                id: h.id,
                name: h.name,
                limit: h.limit,
                marks: h.marks,
                status: h.status,
                weaknesses: [...h.weaknesses],
                resistances: [...h.resistances],
                immunities: [...h.immunities],
                aspects: h.aspects.map(a => ({ id: a.id, name: a.name, boxes: [...a.boxes] })),
                quirks: [...h.quirks],
                ...(h.lastMayflyRoll === undefined ? {} : {
                    lastMayflyRoll: {
                        draws: [...h.lastMayflyRoll.draws],
                        survivors: [...h.lastMayflyRoll.survivors],
                        fallback: h.lastMayflyRoll.fallback,
                        highest: h.lastMayflyRoll.highest,
                        tier: h.lastMayflyRoll.tier,
                        marksRange: [h.lastMayflyRoll.marksRange[0], h.lastMayflyRoll.marksRange[1]],
                    },
                }),
            })),
            dungeonRuns: (state.encounters?.dungeonRuns ?? state.dungeonRuns ?? []).map(r => ({
                id: r.id,
                name: r.name,
                grade: r.grade,
                objective: r.objective,
                law: r.law,
                progress: [...r.progress],
                supply: r.supply === null ? null : [...r.supply],
                riftPressure: [...r.riftPressure],
                status: r.status,
                legs: r.legs.map(leg => ({
                    legNumber: leg.legNumber,
                    pace: leg.pace,
                    scoutDie: leg.scoutDie,
                    scoutDomain: leg.scoutDomain,
                    threatDice: [...leg.threatDice],
                    threatKept: leg.threatKept,
                    threatTier: leg.threatTier,
                    note: leg.note,
                })),
            })),
            tournaments: (state.encounters?.tournaments ?? state.tournaments ?? []).map(t => ({
                id: t.id,
                name: t.name,
                terms: {
                    victoryCondition: t.terms.victoryCondition,
                    arenaLimits: t.terms.arenaLimits,
                    surrenderSignal: t.terms.surrenderSignal,
                    injuryStakes: t.terms.injuryStakes,
                },
                round: t.round,
                interludeTasksRemaining: t.interludeTasksRemaining,
                status: t.status,
                entrants: [...t.entrants],
                bouts: t.bouts.map(b => ({
                    id: b.id,
                    round: b.round,
                    entrantA: b.entrantA,
                    entrantB: b.entrantB,
                    winner: b.winner,
                    method: b.method,
                    note: b.note,
                })),
            })),
        },
    };
}
// One status per accepted scene discloses no target identities, counts, private prose or source metadata.
function projectMemoryPublicationStatus(state) {
    const summaries = new Map();
    for (const job of currentMemoryPublications(state)) {
        let summary = summaries.get(job.document.sceneRecordId);
        if (!summary) {
            summary = { status: job.status, needsDestination: false };
            summaries.set(job.document.sceneRecordId, summary);
        }
        if (job.status === 'conflict')
            summary.status = 'conflict';
        else if (job.status === 'pending' && summary.status !== 'conflict')
            summary.status = 'pending';
        summary.needsDestination ||= job.destination === null;
    }
    return state.sceneRecords.map(record => ({
        operationId: record.operationId, sceneNumber: record.sceneNumber,
        ...(summaries.get(record.id) ?? { status: 'published', needsDestination: false }),
    }));
}
// Review source is selected scene evidence; canonical draft, knowledge and owner revision pins stay private.
function projectSceneReview(state) {
    const review = state.sceneReview;
    if (!review)
        return null;
    const { source, proposal } = review;
    const prose = (entry) => ({ section: entry.section, text: entry.text,
        status: entry.status, relatedPersonIds: [...entry.relatedPersonIds] });
    const anchor = (value) => ({ binding: value.binding,
        nextMessageIndex: value.nextMessageIndex, prefixFingerprint: value.prefixFingerprint });
    return {
        id: review.id, sceneId: review.sceneId, revision: review.revision,
        profilesChanged: review.profileRevisions.some(pin => state.profiles.find(profile => profile.personId === pin.personId).revision !== pin.revision),
        profileBefore: review.profileBefore.map(entry => entry === null ? null : prose(entry)),
        source: { id: source.id, sceneId: source.sceneId, binding: source.binding, fingerprint: source.fingerprint,
            startAnchor: anchor(source.startAnchor), endAnchor: anchor(source.endAnchor),
            messages: source.messages.map(message => ({ position: message.position, speaker: message.speaker,
                text: message.text, swipeId: message.swipeId, revision: message.revision })),
        },
        proposal: { summary: proposal.summary, participants: [...proposal.participants],
            events: proposal.events.map(event => ({ text: event.text, personIds: [...event.personIds],
                sourceIndices: [...event.sourceIndices], knownByAdditions: [...event.knownByAdditions] })),
            profileChanges: proposal.profileChanges.map(change => ({ personId: change.personId, entryId: change.entryId,
                knownByAdditions: [...change.knownByAdditions], replacement: change.replacement === null ? null
                    : { section: change.replacement.section, text: change.replacement.text, status: change.replacement.status,
                        relatedPersonIds: [...change.replacement.relatedPersonIds], sourceIndices: [...change.replacement.sourceIndices] } })),
        },
    };
}
// Persisted records may contain extra metadata: select public fields at every object boundary.
function projectCharacter(character) {
    const named = ({ id, name }) => ({ id, name });
    const track = ({ id, boxes }) => ({ id, boxes: [...boxes] });
    const meter = (entry) => ({ ...named(entry), track: track(entry.track),
        policy: entry.policy, full: entry.full });
    return {
        ...named(character), identity: { ...character.identity },
        backgrounds: character.backgrounds.map(named), edges: character.edges.map(named),
        skills: character.skills.map(entry => ({ ...named(entry), category: entry.category, rank: entry.rank })),
        aspects: character.aspects.map(entry => ({ ...named(entry),
            definition: { id: entry.definition.id, revision: entry.definition.revision },
            track: track(entry.track), status: entry.status,
            acquisition: { source: entry.acquisition.source,
                ...(entry.acquisition.operationId === undefined ? {} : { operationId: entry.acquisition.operationId }) },
        })),
        resources: character.resources.map(entry => ({ ...named(entry), kind: entry.kind,
            tags: entry.tags.map(named), source: entry.source })),
        impulses: character.impulses.map(entry => entry.type === 'text'
            ? { ...named(entry), type: entry.type }
            : { ...meter(entry), type: entry.type, effect: entry.effect }),
        meters: character.meters.map(meter),
        advancement: character.advancement.map(entry => entry.type === 'project'
            ? { ...meter(entry), type: entry.type, earned: entry.earned, rule: entry.rule }
            : { ...named(entry), type: entry.type, kind: entry.kind, spentOn: entry.spentOn }),
        conditions: character.conditions.map(entry => ({ ...meter(entry), kind: entry.kind, effect: entry.effect })),
        possessions: character.possessions.map(named),
    };
}
// Copy the recorded public fields without exposing unrelated nested data.
export function projectActionReceipt(entry) {
    const event = entry.event;
    const receipt = event.kind === 'action-resolved'
        ? { command: event.command.originalActionCommand, result: event.result,
            revision: entry.revision, costs: event.costs, effects: event.effects } : undefined;
    if (!receipt)
        return undefined;
    const { command: c, result: r } = receipt;
    const a = c.action;
    return {
        command: { operationId: c.operationId, campaignId: c.campaignId, branchId: c.branchId,
            expectedRevision: c.expectedRevision,
            source: { messageId: c.source.messageId, messageRevision: c.source.messageRevision },
            action: projectDeclaration(a),
        },
        result: { pool: r.pool, draws: [...r.draws], survivors: [...r.survivors],
            fallback: r.fallback, outcome: r.outcome, twist: r.twist,
            removed: [...r.removed], impact: r.impact,
            cuts: { difficulty: r.cuts.difficulty, rankGap: r.cuts.rankGap,
                mire: r.cuts.mire, injury: r.cuts.injury, precision: r.cuts.precision, impact: r.cuts.impact, total: r.cuts.total },
            origin: { classBonus: r.origin.classBonus,
                uncappedPool: r.origin.uncappedPool, overflow: r.origin.overflow, mandatoryCuts: r.origin.mandatoryCuts,
                remainingMandatoryCuts: r.origin.remainingMandatoryCuts, voluntaryCuts: r.origin.voluntaryCuts },
        },
        revision: receipt.revision, costs: [...receipt.costs], effects: [...receipt.effects],
    };
}
// Message anchors with a recorded outcome, in journal order: decisions, cancellations and receipts.
function projectTurns(campaign) {
    return campaign.journal.flatMap(entry => {
        const event = entry.event;
        const source = entry.context?.source;
        if (!source)
            return [];
        const anchor = { messageId: source.messageId, messageRevision: source.messageRevision, operationId: entry.operationId };
        if (event.kind === 'turn-decided')
            return [{ ...anchor, kind: event.record.kind, ...projectTriage(event.record.triage) }];
        if (event.kind === 'proposal-cancelled')
            return [{ ...anchor, ...event.source, kind: 'cancelled' }];
        if (event.kind === 'action-resolved')
            return [{ ...anchor, kind: event.command.proposalId === undefined ? 'resolved' : 'proposed' }];
        return [];
    });
}
function projectHistory(campaign) {
    const secrets = campaign.snapshot.state.keeperSecrets ?? [];
    return campaign.journal.flatMap(entry => {
        const event = entry.event;
        if (event.kind === 'keeper-secret-added')
            return [];
        if (event.kind === 'turn-decided' && event.record.kind === 'narrative')
            return [];
        if (event.kind === 'keeper-secret-revealed') {
            const secret = secrets.find(s => s.id === event.command.secretId);
            if (!event.command.publishToProfile && (!secret || secret.status === 'hidden')) {
                return [];
            }
        }
        const item = {
            operationId: entry.operationId,
            at: entry.at,
            summary: event.kind === 'keeper-secret-revealed' ? 'Keeper secret revealed.' : entry.summary,
        };
        const receipt = projectActionReceipt(entry);
        if (receipt)
            item.receipt = receipt;
        if (event.kind === 'action-resolved' && event.harm)
            item.harm = structuredClone(event.harm);
        if (event.kind === 'field-corrected')
            item.correction = {
                label: event.label, before: event.before, after: event.after, reason: event.command.reason,
            };
        if (event.kind === 'fields-corrected') {
            item.corrections = event.changes.map(({ command: { ref }, label, before, after }) => ({
                ref: { owner: ref.owner, entityId: ref.entityId, field: ref.field,
                    ...(ref.box === undefined ? {} : { box: ref.box }) }, label, before, after,
            }));
            item.reason = event.reason;
        }
        if (event.kind === 'manual-handled') {
            item.manualNote = event.command.note;
            item.manualTarget = event.command.target;
        }
        return [item];
    });
}
