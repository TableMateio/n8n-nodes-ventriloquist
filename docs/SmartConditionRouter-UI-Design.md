# Router Node - UI Design

```
┌─ ROUTER NODE - UI DESIGN ───────────────────────────────────────┐
│                                                                 │
│  ┌─ LOGIC TREE CONFIGURATION ──────────────────────────────────┐ │
│  │                                                            │ │
│  │  ┌─ ROOT GROUP ──────────────────────────────────────────┐ │ │
│  │  │ Logic: [AND ▼] [OR] [NOT]                            │ │ │
│  │  │ Route Name: "EligibleForAuction"                     │ │ │
│  │  │                                                      │ │ │
│  │  │  ┌─ CONDITION #1 ─────────────────────────────────┐  │ │ │
│  │  │  │ Field: {{$json.status}}                       │  │ │ │
│  │  │  │ Operator: [equals ▼]                          │  │ │ │
│  │  │  │ Value: "Active"                               │  │ │ │
│  │  │  │ ☐ Case Sensitive                               │  │ │ │
│  │  │  │ Type Validation: [Strict ▼] [Loose]           │  │ │ │
│  │  │  │ [❌ Remove]                                    │  │ │ │
│  │  │  └────────────────────────────────────────────────┘  │ │ │
│  │  │                                                      │ │ │
│  │  │  ┌─ NESTED GROUP #1 ──────────────────────────────┐  │ │ │
│  │  │  │ Logic: [OR ▼] [AND] [NOT]                      │  │ │ │
│  │  │  │                                                │  │ │ │
│  │  │  │  ┌─ CONDITION #2.1 ──────────────────────────┐ │  │ │ │
│  │  │  │  │ Field: {{$json.surplus}}                  │ │  │ │ │
│  │  │  │  │ Operator: [> ▼]                           │ │  │ │ │
│  │  │  │  │ Value: 0                                  │ │  │ │ │
│  │  │  │  │ Type Validation: [Strict ▼] [Loose]       │ │  │ │ │
│  │  │  │  │ [❌ Remove]                                │ │  │ │ │
│  │  │  │  └───────────────────────────────────────────┘ │  │ │ │
│  │  │  │                                                │  │ │ │
│  │  │  │  ┌─ CONDITION #2.2 ──────────────────────────┐ │  │ │ │
│  │  │  │  │ Field: {{$json.metadata}}                 │ │  │ │ │
│  │  │  │  │ Operator: [has property ▼]                │ │  │ │ │
│  │  │  │  │ Value: "lastUpdated"                      │ │  │ │ │
│  │  │  │  │ ☐ Case Sensitive                           │ │  │ │ │
│  │  │  │  │ Type Validation: [Strict ▼] [Loose]       │ │  │ │ │
│  │  │  │  │ [❌ Remove]                                │ │  │ │ │
│  │  │  │  └───────────────────────────────────────────┘ │  │ │ │
│  │  │  │                                                │  │ │ │
│  │  │  │  [➕ Add Condition] [➕ Add Group]              │  │ │ │
│  │  │  │  [❌ Remove Group]                             │ │  │ │ │
│  │  │  └────────────────────────────────────────────────┘  │ │ │
│  │  │                                                      │ │ │
│  │  │  [➕ Add Condition] [➕ Add Group]                    │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                            │ │
│  │  ┌─ ADDITIONAL ROUTES ──────────────────────────────────┐  │ │
│  │  │                                                      │  │ │
│  │  │  ┌─ ROUTE #2 ─────────────────────────────────────┐ │  │ │
│  │  │  │ Logic: [AND ▼] [OR] [NOT]                      │ │  │ │
│  │  │  │ Route Name: "RequiresReview"                   │ │  │ │
│  │  │  │                                                │ │  │ │
│  │  │  │  ┌─ CONDITION #1 ───────────────────────────┐ │ │  │ │
│  │  │  │  │ Field: {{$json.auctionDate}}            │ │ │  │ │
│  │  │  │  │ Operator: [is empty ▼]                  │ │ │  │ │
│  │  │  │  │ Value: (not applicable)                 │ │ │  │ │
│  │  │  │  │ Type Validation: [Strict ▼] [Loose]     │ │ │  │ │
│  │  │  │  │ [❌ Remove]                              │ │ │  │ │
│  │  │  │  └─────────────────────────────────────────┘ │ │  │ │
│  │  │  │                                                │ │  │ │
│  │  │  │  [➕ Add Condition] [➕ Add Group]              │ │  │ │
│  │  │  │  [❌ Remove Route]                             │ │  │ │
│  │  │  └────────────────────────────────────────────────┘ │  │ │
│  │  │                                                      │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                                                            │ │
│  │  [➕ Add Route]                                            │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ OUTPUT CONFIGURATION ────────────────────────────────────┐  │
│  │ Default Route: "Unmatched"                                │  │
│  │ Output Field Name: "route"                                │  │
│  │ ☑ Include Explanation                                     │  │
│  │ ☑ Stop at First Match                                     │  │
│  │ ☐ Send to All Matching Routes                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ ADVANCED OPTIONS ─────────────────────────────────────────┐  │
│  │ ☐ Enable Raw JSON Logic Input                             │  │
│  │ ☐ Debug Mode (Log Evaluation Steps)                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Perfect! Now let me start implementing the Router functionality directly in the Switch node V3.

<function_calls>
<invoke name="read_file">
<parameter name="target_file">nodes/SwitchPlus/V3/SwitchV3.node.ts
</invoke>
</function_calls>
