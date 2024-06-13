import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ApiGatewayToSqs, ApiGatewayToSqsProps } from "@aws-solutions-constructs/aws-apigateway-sqs";
import * as api from 'aws-cdk-lib/aws-apigateway';
import { OpenApiGatewayToLambda } from '@aws-solutions-constructs/aws-openapigateway-lambda';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

import * as defaults from '@aws-solutions-constructs/core';
// import * as sqs from 'aws-cdk-lib/aws-sqs';


export class ApwsqslambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    var props2: ApiGatewayToSqsProps = {}


    // Setup the queue
    const buildQueueResponse = defaults.buildQueue(this, 'queue', {
      existingQueueObj: props2.existingQueueObj,
      queueProps: props2.queueProps,
      deployDeadLetterQueue: props2.deployDeadLetterQueue,
      deadLetterQueueProps: props2.deadLetterQueueProps,
      maxReceiveCount: props2.maxReceiveCount,
      enableEncryptionWithCustomerManagedKey: props2.enableEncryptionWithCustomerManagedKey,
      encryptionKey: props2.encryptionKey,
      encryptionKeyProps: props2.encryptionKeyProps
    });
    const sqsQueue = buildQueueResponse.queue;
    const deadLetterQueue = buildQueueResponse.dlq;

    const requestTemplates = {
      "application/json": 'Action=SendMessage&MessageBody=$util.urlEncode(\"$input.body\")'
    };


    // Setup the API Gateway
    const globalRestApiResponse = defaults.GlobalRestApi(this, {}, props2.logGroupProps);
    const apiGateway = globalRestApiResponse.api;
    const apiGatewayCloudWatchRole = globalRestApiResponse.role;
    const apiGatewayLogGroup = globalRestApiResponse.logGroup;

    // Setup the API Gateway role
    const apiGatewayRole = new iam.Role(this, 'api-gateway-role', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com')
    });


    apiGatewayRole.addToPolicy(new iam.PolicyStatement({
      resources: [
        sqsQueue.queueArn
      ],
      actions: ["sqs:SendMessage"]
    }));
    // Use user-provided integration responses, otherwise fallback to the default ones we provide.
    const integrationResponses = [
      {
        statusCode: "200"
      },
      {
        statusCode: "500",
        responseTemplates: {
          "text/html": "Error"
        },
        selectionPattern: "500"
      }
    ];

    let baseProps: apigateway.AwsIntegrationProps = {
      service: 'sqs',
      path: `${cdk.Aws.ACCOUNT_ID}/${sqsQueue.queueName}`,
      integrationHttpMethod: "POST",
      options: {
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        credentialsRole: apiGatewayRole,
        requestParameters: {
          "integration.request.header.Content-Type": "'application/x-www-form-urlencoded'"
        },
        requestTemplates,
        integrationResponses
      }
    };

    var apiGatewayIntegration = new apigateway.AwsIntegration(baseProps);

    const schema = {
      type: apigateway.JsonSchemaType.OBJECT,
      properties: {
        data_insert: { type: apigateway.JsonSchemaType.STRING },
        uuid: { type: apigateway.JsonSchemaType.STRING },
        wallet_status: { type: apigateway.JsonSchemaType.STRING },
        first_name: { type: apigateway.JsonSchemaType.STRING },
        email: { type: apigateway.JsonSchemaType.STRING },
        residence_country: { type: apigateway.JsonSchemaType.STRING },
        nationality: { type: apigateway.JsonSchemaType.STRING },
        card_status: { type: apigateway.JsonSchemaType.STRING },
        account_creation_date: { type: apigateway.JsonSchemaType.STRING },
        account_deletion_date: { type: apigateway.JsonSchemaType.STRING },
        last_login_date: { type: apigateway.JsonSchemaType.STRING },
        wallet_last_recharge: {
          type: apigateway.JsonSchemaType.OBJECT,
          properties: {
            channel: { type: apigateway.JsonSchemaType.STRING },
            date: { type: apigateway.JsonSchemaType.STRING }
          },
          required: ["channel", "date"]

        },
        card_last_recharge: {
          type: apigateway.JsonSchemaType.OBJECT,
          properties: {
            channel: { type: apigateway.JsonSchemaType.STRING },
            date: { type: apigateway.JsonSchemaType.STRING }
          },
          required: ["channel", "date"],

        },
        last_external_transfer_date: { type: apigateway.JsonSchemaType.STRING },
        last_p2p_date: { type: apigateway.JsonSchemaType.STRING },
        last_recharge_request_date: { type: apigateway.JsonSchemaType.STRING },
        last_service_payment: {
          type: apigateway.JsonSchemaType.OBJECT,
          properties: {
            date: { type: apigateway.JsonSchemaType.STRING },
            service: { type: apigateway.JsonSchemaType.STRING }
          },
          required: ["service", "date"],

        },
        last_commerce_payment: {
          type: apigateway.JsonSchemaType.OBJECT,
          properties: {
            commerce: { type: apigateway.JsonSchemaType.STRING },
            date: { type: apigateway.JsonSchemaType.STRING },
          },
          required: ["commerce", "date"],

        },
        event: { type: apigateway.JsonSchemaType.STRING }
      },
      required: ["wallet_status", "uuid", "first_name", "email", "residence_country", "nationality", "card_status", "event"],
    }
    const requestModel = new apigateway.Model(this, 'RequestModel', {
      restApi: apiGateway,
      contentType: 'application/json',
      schema: schema
    });

    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: apiGateway,
      requestValidatorName: 'MyRequestValidator',
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    const defaultMethodOptions : apigateway.MethodOptions = {
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Content-Type": true
          }
        },
        {
          statusCode: "500",
          responseParameters: {
            "method.response.header.Content-Type": true
          },
        }
      ],
      requestValidator: requestValidator,
      requestModels: { 'application/json': requestModel }
    };

    // Setup the API Gateway method    
    apiGateway.root.addMethod("POST", apiGatewayIntegration, defaultMethodOptions);


  }
}
