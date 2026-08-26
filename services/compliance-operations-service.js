const PROCEDURES = Object.freeze({
    owner: 'The configured Flummi developers are responsible; the first available developer becomes case owner and records every material action.',
    abuse: [
        { stage: 'Triage', target: 'Safety threats within 4 hours; other reports within 2 business days', action: 'Confirm receipt, classify severity, preserve only necessary evidence, and assign an owner.' },
        { stage: 'Investigation', target: 'Start within 1 business day', action: 'Check relevant records, avoid contacting an alleged abuser through the reporter, and restrict access to need-to-know staff.' },
        { stage: 'Resolution', target: 'Normally within 30 days', action: 'Record the decision, take proportionate action, notify the reporter where safe, and set the report to resolved or dismissed.' }
    ],
    correction: [
        { stage: 'Acknowledge', target: 'Within 7 days', action: 'Validate ownership and clarify exactly which data is claimed to be incorrect.' },
        { stage: 'Complete', target: 'Within 30 days', action: 'Correct or remove the data across active stores and applicable backups, or provide a reasoned rejection.' },
        { stage: 'Notify', target: 'Immediately after decision', action: 'Update the request and send the requester the outcome through Flummi notifications.' }
    ],
    incident: [
        { stage: 'Contain', target: 'Immediately', action: 'Stop affected processing, revoke exposed credentials, preserve minimal evidence, and disable AI or public access where relevant.' },
        { stage: 'Assess', target: 'Within 24 hours', action: 'Identify affected data, people, systems, processors, likely consequences, and recovery actions.' },
        { stage: 'Escalate', target: 'Without delay', action: 'Escalate immediate danger to emergency services/Discord; escalate provider incidents to the provider and Flummi owner.' },
        { stage: 'Notify', target: 'Authority within 72 hours when legally required; affected people without undue delay when risk is high', action: 'Document the decision even when notification is not required.' },
        { stage: 'Review', target: 'Within 7 days after containment', action: 'Complete root-cause review, rotate remaining credentials, verify recovery, and implement preventive changes.' }
    ]
});

module.exports = { PROCEDURES };
