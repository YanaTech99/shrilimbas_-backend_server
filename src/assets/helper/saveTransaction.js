async function saveTransaction(db, transactionData) {
  const query = [];
  const values = [];
  Object.keys(transactionData).forEach((key) => {
    query.push(key);
    values.push(transactionData[key]);
  });

  const queryStr = `INSERT INTO transactions (${query.join(
    ", "
  )}) VALUES (${query.map(() => "?").join(", ")})`;
  try {
    const [result] = await db.execute(queryStr, values);
    return { success: true, insertId: result.insertId };
  } catch (error) {
    console.error("Error saving transaction:", error);
    return { success: false, error };
  }
}

export { saveTransaction };
