import { Fragment } from 'react';

export function Facts({ facts }: { facts: { label: string; value: string }[] }) {
  return <dl className="result-facts">{facts.map(fact => <Fragment key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></Fragment>)}</dl>;
}
