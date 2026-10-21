import { STARTING_CLASS_COMPETENCE } from "./game/minor-character/sheet.js";
const track = (size, full) => ({ boxes: Array(size).fill('clear'), full });
const aspect = (id, name, size, rule, card = null) => ({
    id, name, type: id === 'cub' ? 'companion' : 'trait', card,
    track: track(size, 'Rule and Advantage unavailable until cleared.'), rule, automation: 'manual',
});
export function createSeedContent() {
    return {
        opening: `Nathan woke at the foot of the collapsed Thornhall tower, unhurt, in Sera's body. The blue System called him User, showed Mage, and greyed out talent and element. A monster drove her into an unmapped cave with a marking older than the castle. Caring for the hurt cub began a bond; she accepted the System's offer to advance to Witch, and the cub became a black cat. Her voice and reflection revealed whose body this was; Sera's giggle slipped out. Wren and Bram helped her drive off the returning monster. The bracelet announced the dungeon cleared without their defeating it. She and the cub teleported out. Her triage scan was blank; Instructor Oakhollow supplied delayed awakening before homeroom sorting. The campaign continues after this established history; Nathan does not yet know Sera really died or what the System recorded.`,
        sheet: {
            name: 'Sera Brooke',
            identity: {
                age: '16, first-year cadet', also: 'Nathan, 38, astrophysicist and author of the unfinished webcomic',
                standing: 'Commoner on a scholarship; Dorian Brooke, her B-rank hunter brother, is her guardian.',
                homeroom: "Instructor Oakhollow's, bottom seat, with Castor, Ren, Wren and Bram",
                talent: 'Origin, SSS, unwritten and unknown to the world',
                element: 'Reads blank; in truth pure and all of them. Access requires learned classes and techniques.',
                assessment: 'Delayed awakening; re-test pending',
            },
            edges: ['Grace', 'Sharps', 'Veils'],
            classCompetence: structuredClone(STARTING_CLASS_COMPETENCE),
            skills: { Weave: 2, Study: 2, Sneak: 1, Sense: 1, Mend: 1 },
            lores: { 'Academy Code': 1, 'System Syntax': 0 },
            expressedRank: 'E', displayedRank: 'Blank', activeClass: 'Witch',
            aspects: [
                aspect('core', 'Origin Core', 6, 'Learn and use any class. Witness a technique; review its first aspect for the archive at scene end, free. Switching marks Fatigue 1, then 2, then 3 per switch in a scene. Battery: mark 2 before one action for Massive impact within permission OR bypass all rank-gap penalties; never both. Other restrictions remain and the roll can fail. Choose class-attack damage type; resist elements of classes held. A filling battery action or switch completes before shutdown and new Mana Strain; existing injuries still apply. May absorb harm to the magical self. Confluence and Awakening are unearned.'),
                aspect('system', 'The System', 6, 'A private blue box calls Sera User, scans what is before her, highlights casting options, and shows a status screen with talent and element greyed out. Roll only when uncertain. Full: silent until repaired. Future capabilities must be earned.'),
                aspect('cub', 'The Cub', 4, 'A shadow beast passing as a black cat, bonded in the Thornhall cave. Scouts reachable shadowed places and shares its senses. May take one Exposure mark in Sera’s place when able to hide the evidence. Reacts to the blend inside her. One companion, not an extra turn.'),
                aspect('hearth-hex', 'Hearth Hex', 5, 'Brew a simple potion or poultice from Reagents as a Create task; lay a small curse imposing a stated Cut on one target’s next relevant action; or ease a wound with Mend. Roll Weave or Mend. Cannot kill by itself or affect an absent target.', 'Witch'),
            ],
            archive: [
                aspect('mana-bolt', 'Mana Bolt', 5, "The mage's first cast, learned in the Thornhall before she advanced to Witch: shape raw mana into a short-ranged bolt or a minor effect — a light, a spark, a shove. Roll Weave; choose the damage type on a class attack (Origin). Modest impact; it cannot affect an absent target.", 'Mage'),
            ],
            gear: ['Ordinary bracelet', 'Academy uniform'],
            resources: [
                { id: 'moss', name: 'Thornhall moss', kind: 'Reagent', tags: ['Medicinal'], source: 'Scraped from the cave wall by the marking.' },
                { id: 'shard', name: 'Shard of the collapsed tower', kind: 'Loot', tags: ['Old'], source: 'Pre-Emergence stone, if the official story is true.' },
                { id: 'map', name: 'Survey map of the Thornhall', kind: 'Intel', tags: ['Faded'], source: 'Issued to first-years; does not show the cave.' },
                { id: 'margin-note', name: 'Margin Note: “the protagonist awakens the week after the dungeon”', kind: 'Rumor or Intel, once', tags: ['Recollection'], source: 'From the comic; unverified.' },
            ],
            drives: ['Live past the death the comic wrote for me.', 'Protect the people in this homeroom, script or no script.', 'Find out what the System wants from User.'],
            mires: [
                { id: 'guilt', name: "Author's Guilt", track: track(2, 'Dominates roleplay; acting against it incurs Cuts equal to marks.'), effect: 'Protect people the comic hurt, even at a cost.' },
                { id: 'body', name: "Thirty-Eight in a Sixteen-Year-Old's Body", track: track(2, 'Dominates roleplay; acting against it incurs Cuts equal to marks.'), effect: "Nathan's reactions are the wrong age, gender and century; someone notices." },
                { id: 'spoiler', name: 'Spoiler Paralysis', track: track(2, 'Dominates roleplay; acting against it incurs Cuts equal to marks.'), effect: 'Freeze when events match the comic, waiting for the beat.' },
            ],
            tracks: {
                exposure: track(6, 'Resolve a specific fact learned, then clear; preserve witnesses and facts. Thresholds: 2 rumour, 4 suspicion, 6 fact. Re-test pending.'),
                canon: track(6, 'Recall unavailable. Mark one per Recall; clear one per confirmed beat.'),
                divergence: { boxes: ['marked', 'clear', 'clear', 'clear'], full: 'Clear, raise level, permanently remove one Canon box. First mark: Sera survived Beat 1.' },
                breakthrough: track(4, 'E→D trial unlocked; success advances expressed rank. Failure leaves this full.'),
            },
            divergenceLevel: 0, rescues: { remaining: 2, total: 3, visibility: 'player-only' },
            projects: [{ id: 'marginalia', name: 'Marginalia', track: track(6, 'Earn a five-box personal trait; never a Class Card aspect.'), earned: false, rule: 'Six-box new-aspect milestone project. Once earned, a fitting specific recollection grants Advantage to a Study, Sense or social action; it does not make the recollection true. No current benefit.' }],
            injuries: [], benefits: [],
            mysteries: ['Why did the rifts open?', 'What is the System and what does it want?', 'Where did the Origin come from?'].map(question => ({ question, discoveries: [], truth: null })),
            chaos: 5, threads: ['Pass the re-test without exposing Origin', 'Learn what the cave marking is'],
            characters: ['Castor Lane', 'Ren Thessaly', 'Instructor Oakhollow', 'Wren Halloway', 'Bram Holt', 'Dorian Brooke', 'The Cub', 'The System', 'The rogue faction (unnamed)'],
            knives: ['The rogue dungeon', 'The protagonist awakens', 'The group forms', 'The second warning', "The rival's challenge", 'The tournament', 'The collision', 'The cliffhanger'].map((name, i) => ({ beat: i + 1, name, status: i === 0 ? 'diverged' : i === 1 ? 'armed' : 'sheathed' })),
            milestones: [],
        },
    };
}
