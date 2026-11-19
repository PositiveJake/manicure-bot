export function sql(strings, ...values) {
  return { text: strings.join('?'), values };
}

export function connectD1(binding) {
  const prepare = ({ text, values }) => binding.prepare(text).bind(...values);
  return {
    get: (query) => prepare(query).first(),
    async all(query) {
      return (await prepare(query).all()).results;
    },
    async run(query) {
      return { rowsAffected: (await prepare(query).run()).meta.changes };
    },
  };
}
