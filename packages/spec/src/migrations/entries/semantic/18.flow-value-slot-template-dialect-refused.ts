// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The template dialect leaves the flow value slots: one dialect for a computed
// value, CEL. Semantic-only — every token spelling authored in flows was
// measured lossy under conversion, so no D2 conversion rewrites any of them.
// The run-user paths are refused too: the flow CEL scope binds current_user,
// the run's user or null. So are the date macros, with their CEL string form
// (isoDate / isoDatetime): no single-brace spelling is kept. The surface widens
// to the maps a node hands to a callee (subflow and map input, script inputs),
// where a guarded form's null is supplied and wins over a child's default, and
// to a screen's three positions that hand a value to the client (an object
// form's defaults, a field's defaultValue, an object form's recordId), each
// evaluated before the screen goes on the wire, and to the list a loop with a
// body and a map iterate (collection), whose literal is an inline array and
// where a variable's bare name, which the structured loop and map never read,
// is refused too, and to a notify node's computed values (its recipients,
// the value or each entry of a list; the templateData map's values; sourceId),
// each evaluated before the notification is handed to the messaging service,
// where an entry that evaluates to a list adds each of its recipients. The
// notify node's sourceObject, actorId and payload values, which the template
// resolved too but no flow computed, are literals now, read as written: a
// token there is refused with the literal's remedy, and an envelope there too.
// The surface widens to an http node's body, one value, the whole payload,
// evaluated before the call (the inline call and the durable outbox send the
// same one); its method, durable, timeoutMs and signingSecret, which the
// template resolved too but no shipped flow computed, are literals read as
// written, refused with the literal's remedy like the notify literals.
export const entry: SemanticMigration = {
  id: 'flow-value-slot-template-dialect-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'flows[].nodes[].config of an assignment node (the assignments map, the legacy assignments array and the '
    + 'legacy bare config), of create_record and update_record nodes (the fields map), and of the nodes that hand '
    + 'a map to a callee: a subflow node and a map node (the input map, evaluated per item on a map node) and a '
    + 'script node (the inputs map), of a screen node (an object form\'s defaults map and its recordId, and '
    + 'each field\'s defaultValue), and of a notify node (recipients, the value or each entry of a list; the '
    + 'templateData map; sourceId; and the literals sourceObject, actorId and the payload map, where a CEL '
    + 'value envelope is refused as well), and of an http node (the body; and the literals method, durable, '
    + 'timeoutMs and signingSecret, where a CEL value envelope is refused as well) — a string value, or a '
    + 'string anywhere inside an array or object value, carrying a single-brace template token, the run-user '
    + 'paths beginning $User. and the date macros NOW() and TODAY() with an optional day offset included; and the '
    + 'collection of a loop node with a body and of a map node — any string value: a single-brace template token, '
    + 'or a variable\'s bare name',
  replacement:
    'a CEL value envelope, { dialect: "cel", source: "…" }, evaluated to the value: a path is the same path '
    + '(record.owner; a numeric segment becomes an index, items[0]; a variable whose name starts with $ is read '
    + 'through vars, vars["$error"].message), arithmetic is the same arithmetic with every integer divisor written '
    + 'as a double (round(x * 100) / 100.0), and text with holes is one concatenation (\'Hello \' + o.name). The '
    + 'run user\'s id, $User.Id, is current_user.id — current_user is the run\'s user, or null when the run has '
    + 'none — and in a flow that can run without a user it is current_user != null ? current_user.id : null, which '
    + 'writes null where the template wrote nothing, so on update_record it clears a stored value the template '
    + 'left alone. Every other run-user path ($User.Email, $User.Name, …) never resolved in any shipped run: '
    + 'current_user carries only what the run holds (id, positions, organizationId, isPlatformAdmin), and an email '
    + 'or a name is read from the user record by current_user.id (a get_record node on sys_user). A date macro is '
    + 'its CEL string form on the UTC calendar: TODAY() is isoDate(today()), TODAY() + N and TODAY() - N are '
    + 'isoDate(daysFromNow(N)) and isoDate(daysAgo(N)), NOW() is isoDatetime(now()), and NOW() plus or minus N is '
    + 'isoDatetime(addDays(now(), N)) with N signed, which keeps the time of day where daysFromNow lands on '
    + 'midnight; a variable offset is isoDate(addDays(today(), days)). Where an envelope is literal data — a string '
    + 'inside an object or list value, or either legacy assignment shape — an envelope written in its place is '
    + 'stored as the object it spells, so the whole value is one envelope building a CEL map or list literal, and '
    + 'a legacy assignment moves into the assignments map. A string with no token is the literal text it spells, '
    + 'and braces meant literally are a CEL string literal. In a subflow or map input, the value is handed to the '
    + 'child flow\'s input variable of that name: a guarded form\'s null is a supplied value that wins over the '
    + 'child variable\'s defaultValue, so to keep the default for an absent value write the default in the guard\'s '
    + 'null branch (has(vars.x) ? vars.x : \'the default\'), and leave the key out only where the value is never '
    + 'meant to be supplied; a script function is handed null where the template handed undefined. On a screen, '
    + 'each envelope is evaluated in the run\'s scope before the screen goes on the wire, so the client receives '
    + 'the value — a record as a map, a list as a list — never the envelope. A guarded form\'s null is served as '
    + 'null where the template served nothing: in an object form\'s defaults the form keeps it as a value and '
    + 'opens the field blank over the object field\'s declared defaultValue, so write that default in the guard\'s '
    + 'null branch to keep it, and a field\'s defaultValue seeds the field with null. recordId stays a string when '
    + 'written as one, and an envelope there must evaluate to the record\'s id, a non-blank string: anything else, '
    + 'null included, fails the run at the screen, so route around a screen whose record may be absent. A loop\'s '
    + 'or a map\'s collection is the list the node iterates: an envelope that evaluates to a list, { dialect: '
    + '"cel", source: "tasks" }, or the items written as an inline array, iterated as written (its strings are '
    + 'data, never interpolated); a variable\'s bare name there is that name in an envelope. Anything the envelope '
    + 'evaluates to but a list fails the node, null included, as a token that resolved to nothing did, so where the '
    + 'list may be absent write a guard answering [] to iterate nothing (has(vars.tasks) ? vars.tasks : []). A '
    + 'notify node\'s recipients holds a recipient — a user id or an audience selector such as team:ID — or a '
    + 'list of them, each a string or an envelope; an envelope evaluates, per run, to a recipient, to null or a '
    + 'blank string, which adds none, as the template dropped a token that resolved to nothing, or to a list, whose '
    + 'every recipient is added, so a recipient field that may be unset is guarded to null '
    + '(has(record.assignee) ? record.assignee : null). Its sourceId evaluates to a string, null leaving the key '
    + 'unset, and its templateData values are handed on as evaluated. Its sourceObject, actorId and payload '
    + 'values are literals, read as written and never evaluated: write the value itself (the object\'s name, the '
    + 'user\'s id, the data), with no token and no envelope. An http node\'s body is one value, the whole payload: '
    + 'an envelope evaluated per run, whose CEL map literal builds an object ({ dialect: "cel", source: "{\'id\': '
    + 'record.id, \'text\': dyn(\'Done: \' + record.title)}" }; CEL holds a map\'s values to one type, so a text '
    + 'or a literal beside a field read is wrapped in dyn), or a literal sent as written; it is evaluated once, '
    + 'before the call, so the durable outbox enqueues the payload the inline call would send. Its method, durable, '
    + 'timeoutMs and signingSecret are literals, read as written: write the method, true or false, the number of '
    + 'milliseconds and the secret itself (a flow saved through the metadata API keeps the secret in the write-only '
    + 'flow credential store), with no token and no envelope',
  reason:
    'The interpolator and the CEL engine answer differently for every token spelling authored in flows, so no '
    + 'conversion is lossless (ADR-0087 D2) and none is applied. A path, an absent variable, key or list index '
    + 'wrote nothing under the template and fails the run under CEL; text with a null hole rendered nothing and '
    + 'CEL refuses + null; CEL divides two integers as integers, so round(x * 100) / 100 truncates 123.46 to 123. '
    + 'Where a value may be absent, which of nothing, null or a default the field should take is the author\'s '
    + 'decision — the template decided it silently. The run user\'s id was the run\'s userId under the template, '
    + 'and nothing in a run with no user (a schedule, a record change made by a system write); the flow CEL scope '
    + 'binds current_user to the run\'s user and to null in such a run, never a pseudo-user, so current_user.id '
    + 'fails there and its guarded form writes null. The other run-user paths read a user object no run carries, '
    + 'so they wrote nothing in every run. The date macros wrote the ISO text of the UTC day or instant, which '
    + 'isoDate and isoDatetime write byte for byte for a whole number of days, but the template read an offset it '
    + 'could not use as 0 — a variable it did not find, a value that is not a number, text that is neither — '
    + 'where CEL fails the run, and it truncated a fractional offset after adding it to the day of the month, where '
    + 'addDays truncates the offset itself and daysFromNow and daysAgo refuse a fraction at build. Where the map '
    + 'is handed to a callee, a whole token that resolved to nothing handed the callee nothing, and the child flow '
    + 'then seeded the input variable from its defaultValue; under CEL that value either fails the run or, guarded, '
    + 'is null, which the child takes as supplied, so the default no longer applies unless the guard writes it. '
    + 'On a screen, a whole token that resolved to nothing served nothing: an object form then seeded the field '
    + 'from the object field\'s defaultValue, and a recordId that resolved to nothing served an edit form with no '
    + 'record, which opened with nothing read and could not save. In a loop\'s or a map\'s collection an absent '
    + 'variable failed the node under the template as well, but as a returned failure (the step\'s NODE_FAILURE, '
    + 'did not resolve to an array) where CEL fails the run with an evaluation fault naming the variable '
    + '(EXECUTION_ERROR), which a fault edge routes alike but the step and the run record differently; and a '
    + 'variable\'s bare name there — the spelling the contract declared — was handed to the interpolator, which '
    + 'returned it unchanged, so the structured loop and map failed every run that reached them, while the '
    + 'same name in an envelope iterates: rewriting it would change what the flow does. A legacy loop with no '
    + 'body is not touched: it reads collection as a bare variable name, unparsed and unjudged. In a notify '
    + 'node\'s recipients a whole token holding a list, written as an entry of a list, was handed on as one '
    + 'recipient joined with commas (u1,u2), which reached nobody, where an envelope entry evaluating to that '
    + 'list adds each recipient: rewriting it changes who is notified; and an absent variable there dropped the '
    + 'recipient under the template, where CEL fails the run unless the value is guarded. At a notify node\'s '
    + 'sourceObject, actorId and payload no authored flow carried a token — none in the shipped metadata, docs '
    + 'and fixtures, none in the one external app measured — so no expression is read there: they are literals, '
    + 'and a token, which the template resolved, would now be sent with its braces, so it is refused. In an '
    + 'http node\'s body the template interpolated every string at any depth before the call, an absent value '
    + 'writing null for a whole token and nothing inside text, and handed a CEL envelope there to the endpoint as '
    + 'the object it spells; under CEL an absent value fails the run unless guarded, and an envelope evaluates. '
    + 'At its method, durable, timeoutMs and signingSecret no shipped flow, doc or fixture in this repository '
    + 'carried a token — only '
    + 'the tests that pinned the interpolation itself, a whole token at timeoutMs or durable resolving to its '
    + 'value\'s type and a signing secret read from a flow variable — so they are literals, and a token would '
    + 'now be sent with its braces or refused by the key\'s type, so it is refused with the literal\'s remedy; '
    + 'the build doors leave signingSecret to the run, whose credential store may hold the secret, and its parse '
    + 'refuses it there. A flow carrying '
    + 'a refused value is refused at registration, by objectstack validate and by the executor; a stored flow '
    + 'carrying one is skipped at boot with a warn naming it.',
  acceptanceCriteria:
    'Run objectstack validate: it reports each refused value as expression-invalid at the node and the value\'s '
    + 'path, with the CEL spelling of its tokens. Rewrite each as that envelope; where a variable or key may be '
    + 'absent, guard it a step at a time from vars, which holds only the variables the run has bound '
    + '(has(vars.x) ? vars.x : null, has(vars.source) && has(vars.source.id) ? vars.source.id : null; a guard on '
    + 'the last key alone, has(source.id), fails the run when source itself was never bound) or route around the '
    + 'node. For the run user, find which flows can run without one (a schedule, a record change '
    + 'a system write can make): there, guard current_user.id, or skip the node with a start condition or a '
    + 'decision on current_user != null where an update_record must leave the stored value alone. For a date '
    + 'macro with a variable offset, check the variable is always set to a number where the flow runs; write a '
    + 'fractional offset as the whole number of days meant. In a subflow or map input where the child\'s '
    + 'defaultValue should apply to an absent value, write that default in the guard\'s null branch, or leave the '
    + 'key out; in an object form\'s defaults, likewise write the object field\'s default in the guard. For a '
    + 'screen\'s recordId, find the paths where the record can be absent and route them around the screen. For a '
    + 'loop\'s or a map\'s collection, write the list\'s variable in the envelope; a bare name there never '
    + 'iterated, so decide whether the loop should run at all before rewriting it, and where the list may be '
    + 'absent and the node should iterate nothing, guard it to answer []. For a notify node\'s recipients, guard '
    + 'each recipient field that may be unset so an absent one is dropped, as the template dropped it, and check '
    + 'that an entry which held a list now reaches each of its recipients. For a notify node\'s sourceObject, '
    + 'actorId or payload value carrying a token, write the value the token stood for. For an http node\'s body, '
    + 'write one envelope building the whole payload, guarding each value that may be absent; for its method, '
    + 'durable, timeoutMs or signingSecret carrying a token, write the value the token stood for (a secret read '
    + 'from a flow variable is written as the secret itself, which a save through the metadata API keeps out of '
    + 'the served definition). Re-run '
    + 'the flow paths that write those fields, serve those screens, iterate those lists, send those '
    + 'notifications and make those http calls, and compare the stored and served values, the iterations, the '
    + 'audiences and the request payloads with the ones the template produced.',
};
