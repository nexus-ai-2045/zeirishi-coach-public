export type SyllabusExercise = {
  use: 'practice' | 'diagnostic' | 'evaluation' | 'retention';
  family: string; prompt: string; answer: string; wrong: [string, string, string]; explanation: string;
  wrongReasons?: [string, string, string];
};
export type SyllabusLesson = {
  id: string; legacyTopicId: string; unitId: string; title: string;
  definition: string; purpose: string; applicability: string; counterexample: string;
  misconception: string; materialCue: string; examUse: string;
  coveredSkills: string[]; remainingSkills: string[]; prerequisiteConceptIds: string[];
  case: { title: string; context: string; consultation: string; task: string; facts: {label:string;value:string}[];
    assumption: string; answer: string; wrong: [string,string,string]; explanation: string; teachBack: string;
    followUp: string; checkpoints: string[]; exceptions: string[]; examTranslation: string };
  exercises: SyllabusExercise[];
};
