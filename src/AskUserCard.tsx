import type { ToolState } from './AgentChat';

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function askUserPresentation(tool: ToolState) {
  const result = fields(tool.result);
  const details = fields(result.details);
  const rawQuestions = details.questions ?? fields(tool.args).questions;
  const answers = Array.isArray(details.answers) ? details.answers.map(fields) : [];
  const interrupted = details.reason === 'timeout' ? 'timed out'
    : details.cancelled && details.reason !== 'unavailable' ? 'cancelled' : undefined;
  const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map(fields).map(question => {
    const options = Array.isArray(question.options) ? question.options.map(fields) : [];
    const type = String(question.type ?? (options.length ? 'select' : 'input'));
    const submitted = answers.filter(answer => answer.id === question.id);
    const choices = type === 'confirm'
      ? [true, false].map(value => ({
        label: value ? 'Yes' : 'No', description: '', selected: submitted.some(answer => answer.value === value)
      }))
      : options.map(option => ({
        label: String(option.label ?? ''), description: String(option.description ?? ''),
        selected: submitted.some(answer => !answer.wasCustom && answer.value === (option.value ?? option.label))
      }));
    const labels = submitted.map(answer => String(answer.label ?? answer.value ?? ''));
    const written = labels.filter((_, index) => type === 'input' || type === 'editor' || submitted[index].wasCustom);
    return {
      id: String(question.id), type, prompt: String(question.prompt ?? ''), choices, written,
      answer: labels.length ? labels.join(', ') : undefined,
      interruption: details.interruptedQuestionId === question.id ? interrupted : undefined
    };
  });
  const first = questions[0];
  const lines = first?.answer?.split(/\r\n|\r|\n/);
  const preview = lines ? ` user: ${lines[0]}${lines.length > 1 ? '…' : ''}` : '';
  return {
    questions, detail: first ? `${first.type}: ${first.prompt}${preview}` : '',
    status: interrupted ?? tool.status
  };
}

export function AskUserQuestions({ questions }: { questions: ReturnType<typeof askUserPresentation>['questions'] }) {
  return <div className="agent-questions">{questions.map((question, index) =>
    <section key={question.id}>
      <header><strong>{questions.length > 1 && `${index + 1}. `}{question.type}: {question.prompt}</strong>
        {question.interruption && <small>{question.interruption}</small>}</header>
      {question.choices.map((choice, i) =>
        <div key={i} className={choice.selected ? 'agent-choice selected' : 'agent-choice'}>
          {choice.label}{choice.description && <div>{choice.description}</div>}
        </div>)}
      {question.written.map((answer, i) => <div className="agent-written-answer" key={i}>user: {answer}</div>)}
    </section>)}</div>;
}
