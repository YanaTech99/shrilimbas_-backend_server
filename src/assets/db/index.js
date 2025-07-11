import mysql from "mysql2/promise";

const dbConfig = {
  host: process.env.DB_HOST, // Use the DB_HOST from .env or default to 'localhost'
  port: process.env.DB_PORT, // Use the DB_PORT from .env or default to 3306
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const pool = mysql.createPool(dbConfig);

export default pool;
