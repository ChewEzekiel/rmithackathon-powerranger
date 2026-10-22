// Research rooms. Each one is a TideCloak group (declared in scripts/realm.json.template).
// The room id is also the ONLY encryption tag on its posts, and the room's
// RelationshipAttestation:1 policy names the group, so the Tide network - not this
// server - decides who can read or write it.
export interface Room {
  id: string;
  title: string;
  question: string;
  institutions: string[];
  sensitivity: string;
}

export const ROOMS: Room[] = [
  {
    id: "alz-biomarkers",
    title: "Alzheimer's blood-test consortium",
    question: "Can a p-tau217 blood test replace PET scans for early Alzheimer's diagnosis?",
    institutions: ["Northbridge University", "Helix Therapeutics", "St Aurelia Hospital"],
    sensitivity: "Pre-publication cohort results and patient-derived assay data",
  },
  {
    id: "dengue-vax",
    title: "Dengue vaccine safety signals",
    question: "Do Phase II sites in Southeast Asia show the same early safety signal?",
    institutions: ["Sunway Institute", "Helix Therapeutics", "KL General Hospital"],
    sensitivity: "Unblinded adverse-event data from three trial sites",
  },
];

export const INSTITUTIONS = Array.from(new Set(ROOMS.flatMap((r) => r.institutions))).sort();

export const groupPath = (roomId: string) => `/rooms/${roomId}`;
// The per-room seal. _tide_decryptor is realm-wide, so each room's READ policy names this role as its
// subject; the unseal change request maps both onto the room's group. Opening one room opens no other.
export const readerRole = (roomId: string) => `room-${roomId}-reader`;
export const findRoom = (id: string) => ROOMS.find((r) => r.id === id);
