import mysql from "mysql2/promise";

const shrilimbasConfig = {
  database: process.env.SHRILIMBAS_DB_NAME, // Use the DB_HOST from .env or default to 'localhost'
  host: process.env.SHRILIMBAS_DB_HOST, // Use the DB_PORT from .env or default to 3306
  user: process.env.SHRILIMBAS_DB_USER,
  password: process.env.SHRILIMBAS_DB_PASSWORD,
  port: process.env.SHRILIMBAS_DB_PORT,
};

const toolbizzConfig = {
  database: process.env.TOOLBIZZ_DB_NAME, // Use the DB_HOST from .env or default to 'localhost'
  host: process.env.TOOLBIZZ_DB_HOST, // Use the DB_PORT from .env or default to 3306
  user: process.env.TOOLBIZZ_DB_USER,
  password: process.env.TOOLBIZZ_DB_PASSWORD,
  port: process.env.TOOLBIZZ_DB_PORT,
};

const shrilimbasPool = mysql.createPool(shrilimbasConfig);
const toolbizzPool = mysql.createPool(toolbizzConfig);

const dbPools = {
  otkhzjwq: toolbizzPool,
  xnprapms: shrilimbasPool,
};

export default dbPools;
