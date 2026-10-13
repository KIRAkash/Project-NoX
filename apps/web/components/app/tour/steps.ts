import { ROLE_BY_ID, type RoleId } from "@/lib/app/roles";

/**
 * What each guided tour says, and what it points at. A step without a `target` is a centred card (the intro).
 * Targets are `data-tour` anchors on the page; a step whose anchor isn't on screen is skipped, so a tour can list
 * everything worth seeing and still read right on an empty home or a phone.
 *
 * Tour keys must match `TOUR_KEYS` in apps/api/nox_api/services/onboarding.py.
 */
export type TourStep = { target?: string; title: string; body: string; tip?: string };

const seatSwitch = (role: RoleId): TourStep => ({
  target: "seat-switch",
  title: "Try another seat",
  body: `Every mission passes through four seats. Switch here to see the same work as ${others(role)}. You can come back any time.`,
});

function others(role: RoleId): string {
  const names = (["business", "product", "engineering", "developer"] as RoleId[]).filter((r) => r !== role).map((r) => `the ${ROLE_BY_ID[r].name.toLowerCase()}`);
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

const sightings: TourStep = {
  target: "sightings",
  title: "Spotted by NoX",
  body: "NoX reads code, tickets and chat across the estate and suggests changes worth making, with the evidence. Launch one as a mission, or wave it off.",
};

const impact: TourStep = {
  target: "nav-impact",
  title: "See the difference it makes",
  body: "Impact is the flight recorder: how long changes take from first sentence to done, and where they wait.",
};

const HOME: Record<RoleId, TourStep[]> = {
  business: [
    {
      title: "Welcome to the request desk",
      body: "As the business user you ask for changes in plain words, follow them, and confirm that what shipped is what you meant. Here's a one-minute look around.",
    },
    {
      target: "composer",
      title: "Ask for a change in one sentence",
      body: "Write what you need the way you'd say it to a colleague. NoX writes it up and gets it to the right people.",
      tip: "Not sure where to start? Tap one of the examples under the box.",
    },
    {
      target: "voice",
      title: "Or just say it",
      body: "Speak your request in any language. NoX writes down what you said, and adds an English version when it helps.",
    },
    {
      target: "capture",
      title: "Show NoX what you mean",
      body: "Add a screenshot and mark it up, or record your screen. NoX reads what's on it and works out which application you mean.",
    },
    {
      target: "app-guess",
      title: "NoX picks the application",
      body: "As you type, NoX guesses which application the request is about. Change it if it's wrong. You never have to.",
    },
    {
      target: "needs-you",
      title: "When it comes back, you decide",
      body: "Requests that need you land here first: a write-up to confirm, or a finished change to try. Nothing is done until you say so.",
    },
    {
      target: "on-their-way",
      title: "Follow every request like a parcel",
      body: "Each card shows where a request is: asked, planning, building, checking, done. No stage names or tickets to learn.",
    },
    {
      target: "ideas",
      title: "Ideas from NoX",
      body: "NoX watches what ships across the company and points out changes you'd feel. Turn any idea into a request with one click.",
    },
    {
      target: "nav-missions",
      title: "All your requests",
      body: "Every request you've made, with the write-up NoX drafted and what each seat added since.",
    },
    {
      target: "nav-atlas",
      title: "See how the company fits together",
      body: "The atlas maps every team and application. Open one and ask its code wiki a question in plain words.",
    },
    impact,
    seatSwitch("business"),
  ],
  product: [
    {
      title: "Welcome to the product board",
      body: "You turn requests into product specs, set what done means, and accept what ships. Here's a quick look around.",
    },
    {
      target: "primary-action",
      title: "Start a mission yourself",
      body: "Write a new mission from scratch. NoX drafts the product spec and the business seat's file with you.",
    },
    {
      target: "triage",
      title: "Requests arrive here",
      body: "New requests from the business land in triage. Set a priority right here, then open one to write its spec with NoX as co-writer.",
    },
    {
      target: "back-for-acceptance",
      title: "You decide what done means",
      body: "Shipped work comes back here. Check it against your acceptance criteria before it goes up to the business.",
    },
    sightings,
    {
      target: "roadmap",
      title: "Now, next, later",
      body: "Open work by priority, so you can see what's coming at a glance and what still needs triage.",
    },
    {
      target: "nav-artifacts",
      title: "Every spec, in one library",
      body: "Specs gathers the spec files from every mission. Search what other teams already decided before you write your own.",
    },
    {
      target: "nav-atlas",
      title: "Applications and their code wikis",
      body: "Configure applications and read the code wikis NoX keeps in sync. Ask any of them a question.",
    },
    impact,
    seatSwitch("product"),
  ],
  engineering: [
    {
      title: "Welcome, flight director",
      body: "You decide which applications change and what must not break, and you own the map of the estate. Here's a quick look around.",
    },
    {
      target: "blast-radius",
      title: "See the blast radius",
      body: "Every application an open mission touches is ringed in the colour of where that mission is. The lines are the contracts between them.",
    },
    {
      target: "design-queue",
      title: "Specs wait for your design",
      body: "Approved product specs land here. Decide which applications change and what has to stay exactly as it is.",
    },
    {
      target: "connectors",
      title: "Keep the sources healthy",
      body: "GitHub, Jira, Confluence and the rest. If one drops, the code wikis drift, so its health shows here.",
    },
    sightings,
    {
      target: "scope-check",
      title: "Check scope when it ships",
      body: "Built work comes back here so you can confirm it stayed inside your design before it goes up the seats.",
    },
    {
      target: "knowledge-bases",
      title: "Code wikis, kept in sync",
      body: "Every application has a code wiki that NoX updates on each push. Watch them go from In the Void to In Orbit.",
    },
    {
      target: "nav-atlas",
      title: "Chart the organization",
      body: "You own the org chart: add teams, invite people, and see the contract map across every application.",
    },
    {
      target: "nav-activity",
      title: "Everything that happened",
      body: "One feed of every knowledge-base build, sync and mission change across your organizations.",
    },
    impact,
    seatSwitch("engineering"),
  ],
  developer: [
    {
      title: "Welcome to the build bay",
      body: "You build missions with your own coding agent, and prove they work before they go back up. Here's a quick look around.",
    },
    {
      target: "primary-action",
      title: "Onboard an application",
      body: "Point NoX at a repository and it builds the application's code wiki, so every seat can ask about it.",
    },
    {
      target: "build-queue",
      title: "Your build queue",
      body: "Missions ready to build. Copy the command and paste it into Antigravity, Gemini CLI or any coding agent. It reads every spec and the code wiki.",
      tip: "/nox NOX-n is all your agent needs.",
    },
    {
      target: "terminal",
      title: "Sign in the nox CLI once",
      body: "Your agent then pulls each mission's context, and the CLI can push knowledge-base updates from your laptop.",
    },
    sightings,
    {
      target: "pull-requests",
      title: "Pull requests, guarded",
      body: "Pull requests linked to missions show here. NoX's guard checks each one against the specs and flags what drifts.",
    },
    {
      target: "verify-first",
      title: "Prove it first",
      body: "When you mark a mission complete, your verification checklist comes first. Then it goes back up the seats.",
    },
    {
      target: "your-apps",
      title: "Your applications",
      body: "Each one with its code wiki's status. Open one to explore the wiki or question it.",
    },
    {
      target: "nav-cli",
      title: "Everything for the CLI",
      body: "Install it, sign in, and set up your agent. NoX Local runs the knowledge-base build on your laptop with Gemma.",
    },
    impact,
    seatSwitch("developer"),
  ],
};

export function homeTour(role: RoleId): TourStep[] {
  return HOME[role];
}

/** The home of someone who started fresh and isn't in any organization yet. */
export function freshTour(role: RoleId): TourStep[] {
  const lead = role === "engineering";
  return [
    {
      title: "An empty sky",
      body: "You started fresh, so there are no organizations here yet. Here's how to get going.",
    },
    {
      target: "fresh-start",
      title: lead ? "Chart your first organization" : "Nothing in your orbit yet",
      body: lead
        ? "Add your company, then its teams. Then onboard an application and NoX builds its code wiki from the repository."
        : "An engineering lead charts organizations and can invite you. Or explore the demo company to see NoX at work.",
    },
    {
      target: "seat-switch",
      title: "Each seat sees it differently",
      body: lead
        ? "Charting organizations belongs to the engineering lead. Switch seats here when you want to ask for a change or build one."
        : "Switch to the engineering lead to chart an organization yourself.",
    },
  ];
}

export function missionTour(role: RoleId): TourStep[] {
  const business = role === "business";
  return [
    {
      title: "This is a mission",
      body: "One change, four seats. Each seat writes one spec file with NoX as co-author, a coding agent builds it, and the seats check it in reverse order.",
    },
    {
      target: "spec-tabs",
      title: business ? "Your file, and the trail" : "One file per seat",
      body: business
        ? "This is your request as NoX wrote it up. Open the full trail to read what product, engineering and development added."
        : "Your file is the only one you can edit. The others are locked, so nobody's words get overwritten. The dot shows each file's status.",
    },
    {
      target: "file-actions",
      title: "Only people approve",
      body: "Approve when it says what you mean, or send it back to an earlier seat with a reason. NoX drafts and checks. It never approves.",
    },
    {
      target: "refine",
      title: "Edit, or let NoX refine it",
      body: "Edit the file yourself, or ask NoX to tighten it. It cites the code wiki for every claim and turns unknowns into open questions.",
    },
    {
      target: "ask-nox",
      title: "Chat with NoX",
      body: "Ask NoX to add a section, rewrite the acceptance criteria or explain something from the code wiki. Edits appear as it types, and each turn can be undone.",
    },
    {
      target: "verify-strip",
      title: "Verified in reverse order",
      body: "Once it's built, each seat ticks its own checklist: developer first, business last. Then the mission is done.",
    },
    {
      target: "evidence",
      title: "Show NoX",
      body: "Add screen recordings and screenshots. NoX reads them and uses what it sees in every draft, and compares them when someone shows it working.",
    },
    {
      target: "ticket",
      title: "Who has it",
      body: "The assignee, the priority and the linked Jira ticket, kept in step both ways.",
    },
    {
      target: "links",
      title: "Jira, pull requests and Jules",
      body: "Link tickets and pull requests, or hand the build to Jules and approve its plan from here.",
    },
    {
      target: "flight",
      title: "Flight recorder",
      body: "How long the mission spent with each seat, so you can see where work waits.",
    },
    {
      target: "timeline",
      title: "The flight log",
      body: "Every save, approval and send-back, with who did it and when.",
    },
  ];
}

export function atlasTour(): TourStep[] {
  return [
    {
      target: "atlas-actions",
      title: "Bring in an application",
      body: "Onboard an application from its repository and connect Confluence, Jira, Notion or Slack. NoX builds a code wiki from all of it.",
    },
    {
      target: "atlas-org",
      title: "The organization, mapped",
      body: "Teams, sub-teams and the applications each one owns. The chip on each application shows where its code wiki is: In the Void to In Orbit.",
    },
    {
      target: "atlas-map",
      title: "The contract map",
      body: "Which application calls which, drawn from the interfaces NoX found in the code. It's how the engineering lead sees what a change could break.",
    },
    {
      target: "atlas-members",
      title: "Who's in this organization",
      body: "Invite people by email. They see this organization and everything beneath it.",
    },
  ];
}

/** An application's page: its code wiki's lifecycle, the wiki itself and Ask. */
export function kbTour(): TourStep[] {
  return [
    {
      target: "kb-tabs",
      title: "Three ways into an application",
      body: "Overview shows how the code wiki was built and what feeds it. Explore reads the wiki page by page. Ask questions it, with citations.",
    },
    {
      target: "kb-lifecycle",
      title: "From the Void to Orbit",
      body: "Every code wiki is scanned, compiled, reviewed as a pull request, then kept in sync on every push.",
    },
    {
      target: "kb-sources",
      title: "More sources, better answers",
      body: "Add a Confluence space, Jira project, Notion page or Slack channel. NoX folds it into the wiki and cites it.",
    },
  ];
}
