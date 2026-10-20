import { sameValue } from "./events.js";
import { admitMemoryDocument, memoryContent } from "./memory-publication.js";
import { assertMemoryBindings, validMemoryDestination } from "./memory-bindings.js";
import { assertPendingSceneReview, assertSceneSource } from "./scene-review.js";
import { validateCharacter } from "../../engine/character.js";
import { EDGES, RANKS } from "./sheet.js";
import { ELEMENTS } from "./state.js";
import { validSceneStartAnchor } from "./scene-anchor.js";
import { validProposalState } from "./proposals.js";
const text = (value) => typeof value === 'string';
const id = (value) => text(value) && !!value.trim();
const integer = (value) => Number.isInteger(value) && value >= 0;
const object = (value) => !!value && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const all = (values, check) => Array.isArray(values) && Array.from(values).every(check);
const strings = (values) => all(values, text);
const unique = (values) => new Set(values).size === values.length;
const named = (value) => object(value) && id(value.id) && text(value.name);
const meter = (value) => named(value) && text(value.policy) && text(value.full)
    && object(value.track) && id(value.track.id) && all(value.track.boxes, box => ['clear', 'marked', 'burned'].includes(box))
    && value.track.boxes.length >= 1 && value.track.boxes.length <= 8;
function requireState(valid) {
    if (!valid)
        throw new Error('Unsupported or damaged Minor Character state; original data retained.');
}
const SHAPE_FIELDS = {
    basis: ['profiles', 'events'], profile: ['personId', 'name', 'entries'],
    entry: ['id', 'section', 'text', 'status', 'sources'], event: ['id', 'text', 'sources'],
    conflict: ['actual'], scene: ['kind', 'snapshotId', 'messageIndex'],
    content: ['kind', 'documentId', 'revision', 'section', 'excerpt'], operation: ['kind', 'operationId'],
};
function exact(value, fields) {
    return object(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}
function characterShape(c) {
    return named(c) && object(c.identity) && Object.values(c.identity).every(text)
        && all(c.backgrounds, named) && all(c.edges, edge => named(edge) && EDGES.includes(edge.name))
        && all(c.possessions, named)
        && all(c.skills, skill => named(skill) && ['skill', 'lore'].includes(skill.category)
            && integer(skill.rank) && skill.rank <= 3)
        && all(c.aspects, aspect => named(aspect) && object(aspect.definition)
            && id(aspect.definition.id) && Number.isSafeInteger(aspect.definition.revision) && aspect.definition.revision >= 1
            && object(aspect.track) && id(aspect.track.id) && all(aspect.track.boxes, box => ['clear', 'marked', 'burned'].includes(box))
            && aspect.track.boxes.length >= 1 && aspect.track.boxes.length <= 8
            && ['owned', 'retired'].includes(aspect.status) && object(aspect.acquisition)
            && text(aspect.acquisition.source) && (aspect.acquisition.operationId === undefined || id(aspect.acquisition.operationId)))
        && all(c.resources, resource => named(resource) && text(resource.kind) && all(resource.tags, named) && text(resource.source))
        && all(c.impulses, impulse => named(impulse) && (impulse.type === 'text'
            || (impulse.type === 'tracked' && meter(impulse) && impulse.policy === 'minor-character/mire' && text(impulse.effect))))
        && all(c.meters, meter)
        && all(c.advancement, entry => named(entry) && (entry.type === 'project'
            ? meter(entry) && entry.policy === 'minor-character/project' && typeof entry.earned === 'boolean' && text(entry.rule)
            : entry.type === 'milestone' && ['minor', 'major'].includes(entry.kind)
                && (entry.spentOn === null || text(entry.spentOn))))
        && all(c.conditions, condition => meter(condition) && ['injuries', 'benefits'].includes(condition.kind)
            && condition.policy === `minor-character/${condition.kind}` && text(condition.effect));
}
function classShape(c) {
    return object(c) && id(c.characterId) && id(c.activeClassId)
        && (c.manifestedElement === null || ELEMENTS.includes(c.manifestedElement))
        && Number.isSafeInteger(c.switchesThisScene) && c.switchesThisScene >= 0
        && (c.manaStrainId === null || id(c.manaStrainId))
        && RANKS.includes(c.expressedRank) && (c.displayedRank === 'Blank' || RANKS.includes(c.displayedRank))
        && integer(c.divergenceLevel) && c.divergenceLevel <= 3
        && object(c.rescues) && integer(c.rescues.remaining) && integer(c.rescues.total)
        && c.rescues.remaining <= c.rescues.total && c.rescues.visibility === 'player-only'
        && all(c.classes, entry => named(entry) && ['base', 'advanced', 'master', 'rare', 'unknown'].includes(entry.tier)
            && (entry.sourceClassIds === undefined || strings(entry.sourceClassIds))
            && all(entry.competence, bonus => object(bonus) && id(bonus.skillId) && integer(bonus.bonus)))
        && all(c.placements, placement => object(placement) && id(placement.aspectId)
            && ['personal', 'card', 'archive'].includes(placement.location)
            && (placement.classId === null || id(placement.classId)));
}
function sourceShape(source, sources) {
    return object(source) && (source.kind === 'content'
        ? id(source.documentId) && id(source.revision) && id(source.section) && id(source.excerpt)
        : source.kind === 'operation' ? id(source.operationId)
            : source.kind === 'scene' && Number.isSafeInteger(source.messageIndex) && source.messageIndex >= 0
                && source.messageIndex < (sources.get(source.snapshotId)?.messages.length ?? -1));
}
function validateProfiles(s, replay) {
    const people = [...s.characters.map(person => person.id), ...s.world.characters.map(person => person.id)];
    const references = (ids) => all(ids, value => people.includes(value)) && unique(ids);
    const entryShape = (entry) => object(entry) && id(entry.id) && text(entry.text)
        && ['overview', 'personality', 'background', 'nathan-background', 'relationships', 'concerns'].includes(entry.section)
        && ['established', 'recollection', 'unconfirmed'].includes(entry.status)
        && typeof entry.playerVisible === 'boolean' && references(entry.relatedPersonIds) && references(entry.knownBy)
        && all(entry.sources, source => sourceShape(source, sourcesById)) && entry.sources.length > 0;
    requireState(all(s.sceneRecords, record => object(record) && id(record.id) && id(record.sceneId)
        && Number.isSafeInteger(record.sceneNumber) && record.sceneNumber >= 1 && record.sceneNumber < s.world.scene.number
        && id(record.operationId) && id(record.branchId) && Number.isSafeInteger(record.revision) && record.revision >= 1
        && object(record.source) && Array.isArray(record.source.messages) && object(record.draft))
        && unique(s.sceneRecords.map(record => record.id)) && unique(s.sceneRecords.map(record => record.sceneId))
        && unique(s.sceneRecords.map(record => record.source.id)));
    const sourcesById = new Map(s.sceneRecords.map(record => [record.source.id, record.source]));
    const recordsById = new Map(s.sceneRecords.map(record => [record.id, record]));
    for (const record of s.sceneRecords) {
        if (replay?.sceneRecords.has(record))
            continue;
        assertSceneSource({ ...s, world: { ...s.world, scene: { id: record.sceneId, number: record.sceneNumber,
                    startAnchor: record.source.startAnchor } } }, record.source);
        requireState(text(record.draft.summary) && references(record.draft.participants)
            && all(record.draft.events, event => object(event) && id(event.id) && id(event.text)
                && references(event.personIds) && references(event.knownBy) && typeof event.playerVisible === 'boolean'
                && all(event.sources, source => sourceShape(source, sourcesById)) && event.sources.length > 0)
            && unique(record.draft.events.map(event => event.id))
            && all(record.draft.profileChanges, change => object(change) && people.includes(change.personId) && id(change.entryId)
                && (change.replacement === null || (entryShape(change.replacement) && change.replacement.id === change.entryId))));
        replay?.sceneRecords.add(record);
    }
    requireState(unique(people) && all(s.profiles, profile => object(profile) && people.includes(profile.personId)
        && strings(profile.aliases) && (profile.portrait === null || text(profile.portrait))
        && Number.isSafeInteger(profile.revision) && profile.revision >= 0
        && all(profile.entries, entryShape) && unique(profile.entries.map(entry => entry.id)))
        && unique(s.profiles.map(profile => profile.personId))
        && references(s.retiredPersonIds) && s.retiredPersonIds.every(personId => s.world.characters.some(person => person.id === personId)));
    requireState(all(s.sceneEventCorrections, correction => object(correction) && Object.keys(correction).length === 6
        && id(correction.operationId) && id(correction.before) && id(correction.after) && id(correction.reason)
        && recordsById.get(correction.sceneRecordId)?.draft.events.some(event => event.id === correction.eventId && event.playerVisible) === true)
        && unique(s.sceneEventCorrections.map(correction => correction.operationId)));
    assertMemoryBindings(s);
    const versions = new Map();
    const operations = new Map();
    requireState(all(s.memoryPublications, job => {
        if (!object(job) || !['pending', 'published', 'conflict'].includes(job.status)
            || !(job.destination === null || validMemoryDestination(job.destination)) || !object(job.document))
            return false;
        const doc = job.document;
        let recorded = operations.get(doc.key);
        if (recorded?.has(doc.acceptedOperationId))
            return false;
        if (!recorded) {
            recorded = new Set();
            operations.set(doc.key, recorded);
        }
        recorded.add(doc.acceptedOperationId);
        if (replay?.publications.has(job)) {
            versions.set(job.document.key, job);
            return true;
        }
        const source = (value) => sourceShape(value, sourcesById) && exact(value, SHAPE_FIELDS[value.kind]);
        const basis = job.basis;
        if (!exact(basis, SHAPE_FIELDS.basis)
            || !all(basis.profiles, profile => exact(profile, SHAPE_FIELDS.profile)
                && people.includes(profile.personId) && text(profile.name)
                && all(profile.entries, entry => exact(entry, SHAPE_FIELDS.entry)
                    && id(entry.id) && id(entry.section) && text(entry.text)
                    && ['established', 'recollection', 'unconfirmed'].includes(entry.status) && all(entry.sources, source))
                && unique(profile.entries.map(entry => entry.id)))
            || !unique(basis.profiles.map(profile => profile.personId))
            || !all(basis.events, event => exact(event, SHAPE_FIELDS.event) && id(event.id)
                && text(event.text) && all(event.sources, source)) || !unique(basis.events.map(event => event.id)))
            return false;
        if (job.conflict !== null) {
            if (!exact(job.conflict, SHAPE_FIELDS.conflict) || job.destination === null || job.status !== 'conflict')
                return false;
            if (job.conflict.actual !== null)
                admitMemoryDocument(job.conflict.actual, doc.key);
        }
        else if (job.status === 'conflict')
            return false;
        if (job.resolution !== null && (!job.conflict || !sameValue(job.resolution, job.conflict)))
            return false;
        if (!(job.acknowledgement === null || sameValue(job.acknowledgement, doc))
            || !(job.failure === null || job.failure === 'Delivery could not be verified.')
            || (job.status === 'published' && (job.destination === null || job.acknowledgement === null || job.failure !== null)))
            return false;
        if (doc.content !== memoryContent(basis))
            return false;
        const record = recordsById.get(doc.sceneRecordId), previous = versions.get(doc.key);
        if (previous ? !sameValue(job.predecessor, { documentKey: previous.document.key, acceptedOperationId: previous.document.acceptedOperationId })
            || !sameValue(job.destination, previous.destination) || doc.acceptedRevision <= previous.document.acceptedRevision
            : job.predecessor !== null || doc.acceptedOperationId !== record?.operationId || doc.acceptedRevision !== record?.revision)
            return false;
        const valid = !!record && id(doc.campaignId) && id(doc.acceptedOperationId) && doc.branchId === record.branchId
            && Number.isSafeInteger(doc.acceptedRevision) && doc.acceptedRevision >= record.revision
            && (doc.targetPersonId === null || people.includes(doc.targetPersonId))
            && object(doc.audience) && doc.audience.characterId === (doc.targetPersonId ?? s.playerCharacterId)
            && doc.key === JSON.stringify(['memory', doc.campaignId, doc.branchId, record.operationId,
                doc.targetPersonId === null ? 'canonical' : 'person', doc.targetPersonId])
            && object(doc.source) && doc.source.snapshotId === record.source.id && doc.source.fingerprint === record.source.fingerprint
            && text(doc.content) && all(doc.profileRevisions, pin => object(pin)
            && Number.isSafeInteger(pin.revision) && pin.revision >= 0
            && s.profiles.some(profile => profile.personId === pin.personId && profile.revision >= pin.revision))
            && unique(doc.profileRevisions.map(pin => pin.personId));
        if (valid) {
            versions.set(doc.key, job);
            replay?.publications.add(job);
        }
        return valid;
    }));
    assertPendingSceneReview(s);
}
// Validate the complete game-owned persisted shape before shared validation or projection.
export function validateMinorState(value, replay) {
    const s = value;
    requireState(object(s) && validProposalState(s));
    requireState(object(s) && id(s.playerCharacterId) && all(s.characters, characterShape)
        && s.characters.length > 0 && all(s.classState, classShape)
        && all(s.definitions, definition => named(definition) && Number.isSafeInteger(definition.revision) && definition.revision >= 1
            && ['trait', 'gear', 'companion'].includes(definition.type) && text(definition.description)
            && strings(definition.restrictions) && text(definition.full)
            && all(definition.effects, effect => object(effect) && effect.kind === 'manual' && text(effect.text)))
        && object(s.world) && integer(s.world.chaos) && s.world.chaos >= 1 && s.world.chaos <= 9 && text(s.world.opening)
        && object(s.world.scene) && id(s.world.scene.id)
        && validSceneStartAnchor(s.world.scene.startAnchor)
        && Number.isSafeInteger(s.world.scene.number) && s.world.scene.number >= 1
        && all(s.world.threads, named) && all(s.world.characters, named)
        && all(s.world.knives, knife => named(knife) && integer(knife.beat)
            && ['diverged', 'armed', 'sheathed', 'drawn', 'resolved'].includes(knife.status))
        && all(s.world.mysteries, mystery => object(mystery) && id(mystery.id) && text(mystery.question)
            && all(mystery.discoveries, named) && (mystery.truth === null || text(mystery.truth)))
        && (s.pending === null || (object(s.pending) && s.pending.kind === 'manual-action' && id(s.pending.operationId))));
    requireState(unique(s.characters.map(c => c.id)) && s.characters.some(c => c.id === s.playerCharacterId)
        && unique(s.classState.map(c => c.characterId)) && s.classState.length === s.characters.length
        && s.classState.every(c => s.characters.some(character => character.id === c.characterId)));
    for (const entries of [s.world.threads, s.world.characters, s.world.knives, s.world.mysteries,
        ...s.world.mysteries.map(mystery => mystery.discoveries)])
        requireState(unique(entries.map(entry => entry.id)));
    validateProfiles(s, replay);
    for (const character of s.characters) {
        validateCharacter(character, s.definitions);
        const classes = s.classState.find(entry => entry.characterId === character.id);
        requireState(classes.manaStrainId === null || character.conditions.some(condition => condition.id === classes.manaStrainId && condition.kind === 'injuries' && condition.track.boxes.length === 2));
        requireState(unique(classes.classes.map(entry => entry.id)) && unique(classes.classes.map(entry => entry.name))
            && classes.classes.some(entry => entry.id === classes.activeClassId)
            && unique(character.edges.map(edge => edge.name))
            && unique(character.skills.map(skill => JSON.stringify([skill.category, skill.name]))));
        for (const entry of classes.classes) {
            requireState(unique(entry.competence.map(bonus => bonus.skillId)) && entry.competence.every(bonus => character.skills.some(skill => skill.id === bonus.skillId && skill.category === 'skill'))
                && (entry.sourceClassIds === undefined || (unique(entry.sourceClassIds)
                    && entry.sourceClassIds.every(source => classes.classes.some(candidate => candidate.id === source)))));
        }
        requireState(unique(classes.placements.map(placement => placement.aspectId))
            && classes.placements.length === character.aspects.length
            && classes.placements.every(placement => character.aspects.some(aspect => aspect.id === placement.aspectId)
                && (placement.classId === null || classes.classes.some(entry => entry.id === placement.classId))
                && (placement.location !== 'personal' || placement.classId === null)
                && (placement.location !== 'card' || placement.classId !== null)
                && (!['core', 'system', 'cub', 'marginalia'].includes(placement.aspectId) || placement.location === 'personal')));
        requireState(character.meters.length === 4
            && ['exposure', 'canon', 'divergence', 'breakthrough'].every(name => character.meters.filter(meter => meter.policy === `minor-character/${name}`).length === 1));
    }
    const people = [...s.characters.map(person => person.id), ...s.world.characters.map(person => person.id)];
    if (s.bankedTwists !== undefined) {
        requireState(all(s.bankedTwists, twist => object(twist) && id(twist.id) && id(twist.sceneId)
            && id(twist.operationId) && id(twist.description) && typeof twist.spent === 'boolean'
            && (twist.spentNote === undefined || id(twist.spentNote)))
            && unique(s.bankedTwists.map(twist => twist.id)));
    }
    if (s.exposureLog !== undefined) {
        requireState(all(s.exposureLog, inc => object(inc) && id(inc.id) && id(inc.witness) && id(inc.description)
            && typeof inc.absorbedByCub === 'boolean'
            && (inc.threshold === null || ['rumour', 'suspicion', 'fact'].includes(inc.threshold))
            && (inc.learnedFact === null || id(inc.learnedFact)))
            && unique(s.exposureLog.map(inc => inc.id)));
    }
    if (s.milestoneAllowance !== undefined) {
        requireState(object(s.milestoneAllowance)
            && integer(s.milestoneAllowance.minorThisSession) && s.milestoneAllowance.minorThisSession <= 1
            && integer(s.milestoneAllowance.majorThisArc) && s.milestoneAllowance.majorThisArc <= 1);
    }
    if (s.coreDevelopments !== undefined) {
        requireState(object(s.coreDevelopments)
            && typeof s.coreDevelopments.confluence === 'boolean'
            && typeof s.coreDevelopments.awakening === 'boolean'
            && typeof s.coreDevelopments.awakeningUsedThisArc === 'boolean'
            && (s.coreDevelopments.awakeningActiveSceneId === null || id(s.coreDevelopments.awakeningActiveSceneId)));
    }
    if (s.keeperSecrets !== undefined) {
        requireState(all(s.keeperSecrets, sec => object(sec) && id(sec.id)
            && (sec.personId === null || people.includes(sec.personId))
            && id(sec.title) && id(sec.secret) && ['hidden', 'revealed'].includes(sec.status)
            && (sec.revealedOperationId === undefined || id(sec.revealedOperationId))
            && all(sec.clues, clue => object(clue) && id(clue.id) && id(clue.text) && typeof clue.revealed === 'boolean'
                && (clue.revealedOperationId === undefined || id(clue.revealedOperationId)))
            && unique(sec.clues.map(clue => clue.id)))
            && unique(s.keeperSecrets.map(sec => sec.id)));
    }
    const validHazards = (hazards) => all(hazards, h => object(h) && id(h.id) && id(h.name) && integer(h.limit) && h.limit >= 3 && h.limit <= 20
        && integer(h.marks) && h.marks <= h.limit && ['active', 'defeated'].includes(h.status)
        && all(h.weaknesses, el => ELEMENTS.includes(el)) && all(h.resistances, el => ELEMENTS.includes(el))
        && all(h.immunities, el => ELEMENTS.includes(el))
        && all(h.aspects, a => object(a) && id(a.id) && id(a.name)
            && all(a.boxes, box => ['clear', 'marked', 'burned'].includes(box)) && a.boxes.length >= 1 && a.boxes.length <= 20)
        && unique(h.aspects.map(a => a.id)) && strings(h.quirks)
        && (h.lastMayflyRoll === undefined || (object(h.lastMayflyRoll) && Array.isArray(h.lastMayflyRoll.draws)
            && Array.isArray(h.lastMayflyRoll.survivors)
            && (h.lastMayflyRoll.fallback === null || integer(h.lastMayflyRoll.fallback))
            && integer(h.lastMayflyRoll.highest) && ['tentative', 'normal', 'devastating'].includes(h.lastMayflyRoll.tier)
            && Array.isArray(h.lastMayflyRoll.marksRange) && h.lastMayflyRoll.marksRange.length === 2)))
        && unique(hazards.map(h => h.id));
    const validDungeonRuns = (runs) => all(runs, r => object(r) && id(r.id) && id(r.name) && id(r.grade) && id(r.objective) && id(r.law)
        && all(r.progress, box => ['clear', 'marked', 'burned'].includes(box)) && r.progress.length >= 2 && r.progress.length <= 12
        && (r.supply === null || (all(r.supply, box => ['clear', 'marked', 'burned'].includes(box)) && r.supply.length === 3))
        && all(r.riftPressure, box => ['clear', 'marked', 'burned'].includes(box)) && r.riftPressure.length === 6
        && ['active', 'arrived', 'broken'].includes(r.status)
        && all(r.legs, leg => object(leg) && integer(leg.legNumber) && leg.legNumber >= 1
            && ['careful', 'swift', 'camp'].includes(leg.pace)
            && (leg.scoutDie === null || (integer(leg.scoutDie) && leg.scoutDie >= 1 && leg.scoutDie <= 6))
            && (leg.scoutDomain === null || ['Peace', 'Order', 'Nature'].includes(leg.scoutDomain))
            && Array.isArray(leg.threatDice)
            && (leg.threatKept === null || (integer(leg.threatKept) && leg.threatKept >= 1 && leg.threatKept <= 6))
            && (leg.threatTier === null || ['opportunity', 'hazard-payoff', 'danger', 'authored'].includes(leg.threatTier))
            && text(leg.note)))
        && unique(runs.map(r => r.id));
    const validTournaments = (tournaments) => all(tournaments, t => object(t) && id(t.id) && id(t.name) && object(t.terms)
        && id(t.terms.victoryCondition) && id(t.terms.arenaLimits) && id(t.terms.surrenderSignal) && id(t.terms.injuryStakes)
        && [1, 2, 3].includes(t.round) && integer(t.interludeTasksRemaining)
        && ['active', 'completed', 'eliminated'].includes(t.status)
        && strings(t.entrants) && t.entrants.length === 8
        && all(t.bouts, b => object(b) && id(b.id) && [1, 2, 3].includes(b.round)
            && id(b.entrantA) && id(b.entrantB) && (b.winner === null || id(b.winner))
            && (b.method === null || ['victory', 'yield', 'offscreen'].includes(b.method)) && text(b.note))
        && unique(t.bouts.map(b => b.id)))
        && unique(tournaments.map(t => t.id));
    if (s.hazards !== undefined)
        requireState(validHazards(s.hazards));
    if (s.dungeonRuns !== undefined)
        requireState(validDungeonRuns(s.dungeonRuns));
    if (s.tournaments !== undefined)
        requireState(validTournaments(s.tournaments));
    if (s.encounters !== undefined) {
        requireState(object(s.encounters) && validHazards(s.encounters.hazards)
            && validDungeonRuns(s.encounters.dungeonRuns) && validTournaments(s.encounters.tournaments));
    }
}
