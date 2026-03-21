import './connect.js';
import cors from 'cors';
import express from 'express';
import { authRoutes } from './routes/authRoutes.js';
import { dashboardRoutes } from './routes/dashboardRoutes.js';
import { expenseRoutes } from './routes/expenseRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { householdRoutes } from './routes/householdRoutes.js';
import { errorHandler } from './middlewares/errorHandler.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/expenses', expenseRoutes);
app.use('/admin', adminRoutes);
app.use('/household', householdRoutes);

app.use(errorHandler);

export { app };
