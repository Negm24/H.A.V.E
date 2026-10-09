# H.A.V.E system-design diagrams

These diagrams describe the accepted H.A.V.E design, not the current implemented database or API. The documentation cleanup does not itself change the backend or frontend code.

## Whole-system context

[Edit the context diagram in Lucidchart](https://lucid.app/lucidchart/0cca437e-1e75-4443-9298-a92ffcc4bd01/edit)

![H.A.V.E whole-system context](<Context/H.A.V.E — System Context Diagram(Lucidchart).png>)

Three frontends—H.A.V.E Terminal, H.A.V.E Advisor, and H.A.V.E Hub—connect to one central backend. Payment is digitally mocked; no physical card reader is required. H.A.V.E Operation is deferred.

## Level 1 logical DFD

[Edit the Level 1 logical DFD in Lucidchart](https://lucid.app/lucidchart/228bdf3d-aee5-4e27-a27b-bf46c0623f61/edit)

The Level 1 DFD is unfinished and needs revision against the current requirements and accepted ERD. Its existing coverage includes identity and doctor approval, product discovery, prescriptions, order preparation, payment and dispensing, and receipts/reporting. Any older audit, approval-code, or insurance-claim flows must not be treated as accepted requirements: doctor approval now uses restricted Django admin, insurance is a local calculation, and there are no dedicated audit-event or outbox tables. Repeated actor/service boxes represent the same entity. Lucidchart is the editable source; a local DFD image export is not included yet.

## Whole-system ERD v1.0

[Edit the six-page ERD in Lucidchart](https://lucid.app/lucidchart/7665a8f5-ffd3-474a-b74e-0a296ed603f3/edit)

[Field dictionary and accepted rules](ERD/have-erd-v1.0.md) · [Six-page PDF export](<ERD/H.A.V.E — ERD v1.0 _ Overview & Detailed Views.pdf>)

The `ERD/` folder also contains one PNG export for each of the six pages: overview, accounts/approval, catalogue/inventory, prescriptions, orders/fulfilment, and insurance/payment/receipts. Lucidchart is the editable presentation; the PDF and PNG files are snapshots and must be exported again after diagram edits. The earlier schema/import JSON files are not included in the cleaned-up documentation folder.

The accepted design contains 21 application tables covering accounts, owner approval, refresh tokens, catalogue, per-terminal inventory, prescriptions, guest/customer orders, simple insurance, saved payment methods, payments, and receipts. It is a design artifact, not a migration of the preserved backend. The context and unfinished Level 1 DFD need later updates to reflect the small owner dashboard and simplified insurance.

## Documentation scope

The earlier auth ERDs, backend-architecture documents, and document/rendering scripts have been removed from the local `docs` folder. They are not current references in this index. The retained design documentation consists of the context export, accepted ERD exports and field dictionary, and links to the editable Lucidchart diagrams. A diagram is not evidence that its entire schema or behavior has been implemented.

The backend has been reset to an empty Django starting point for step-by-step implementation. The trial auth implementation, its runtime data, implementation report, testing guide and Postman collection have been removed. The approved design artifacts above remain the reference for future work.
