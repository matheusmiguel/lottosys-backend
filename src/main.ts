import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RmqOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { useApitally } from "apitally/nestjs";

async function bootstrap() {
	const app = await NestFactory.create(AppModule);

	await useApitally(app, {
		clientId: "814a055f-861e-4774-8433-00457f5a4848",
		env: "prod", // or "dev"

		// Optionally enable and configure request logging
		requestLogging: {
			enabled: true,
			logRequestHeaders: true,
			logRequestBody: true,
			logResponseBody: true,
			captureLogs: true,
			captureTraces: false, // requires instrumentation
		},
	});

	// DTOs 
	app.useGlobalPipes(
		new ValidationPipe({
			transform: true
		}),
	);


	/* Listener RabbitMQ
	app.connectMicroservice<RmqOptions>({
		transport: Transport.RMQ,
		options: {
			urls: [process.env.RABBITMQ_URL!],
			queue: process.env.RABBITMQ_QUEUE,
			queueOptions: {
				durable: true,
			},
		},
	});
	await app.startAllMicroservices(); */

	// CORS
	app.enableCors();

	await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
