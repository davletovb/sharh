// The readings a person asks for in the conversation. One table says what each runs as and on which tier, so the
// interface, the tests and the evaluation cannot disagree. A task is a lens, optionally an operation of it, a
// record budget and a tier: Quick for descriptive help, Analysis where the answer is a judgment or a composition.
export const TASKS=Object.freeze({
  gist:{label:'Get the gist',lens:'summary',operation:'gist',budget:2,tier:'analysis'},
  argument:{label:'Check the argument',lens:'check',budget:10,tier:'analysis'},
  terms:{label:'Learn the terms',lens:'terms',operation:'learn',budget:8,tier:'quick'},
  deep:{label:'Study it deeply',lens:'deep',budget:22,tier:'analysis'},
  outline:{label:'How it is built',lens:'structure',operation:'outline',budget:12,tier:'quick'},
  ideas:{label:'Main ideas',lens:'ideas',budget:5,tier:'analysis'},
  kind:{label:'What kind of text this is',lens:'meta-reading',tier:'quick'},
  cites:{label:'Who it cites',lens:'literature',tier:'quick'},
  questions:{label:'Questions to check yourself',lens:'questions',operation:'quiz',budget:5,tier:'quick'}
});
export const TASK_TIERS=Object.freeze(['quick','analysis']);
// What a run of this task asks the workspace for. useTier picks the model tier; the rest is the run's own configuration.
export function taskRun(id) {
  const task=TASKS[id];if(!task)throw Error('UNKNOWN_TASK');
  return {lens:task.lens,...(task.operation?{operation:task.operation}:{}),...(task.budget?{budget:task.budget}:{}),useTier:task.tier};
}
